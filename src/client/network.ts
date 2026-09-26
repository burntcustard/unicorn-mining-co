import * as Vec from '../shared/vector';
import { packPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { type SimulationEvent } from '../shared/protocol/events';
import {
  type ClientMessage,
  type ReplicatedEntity,
  type ServerMessage,
} from '../shared/protocol/network';
import { createRandom } from '../shared/seeded-random';
import { addPlayer, createWorld } from '../shared/simulation/world';
import { createAsteroid } from '../shared/simulation/asteroid';
import { itemTypes } from '../shared/items';
import { GameObject } from '../shared/game-object';
import { Craft } from '../shared/craft/craft';
import { Ship } from '../shared/craft/ship';
import { Station } from '../shared/craft/station';
import { createShip } from '../shared/craft/create-ship';
import { createWreckage } from '../shared/craft/create-wreckage';
import { createStation } from '../shared/craft/create-station';
import { type SimulationWorld } from '../shared/simulation/world';
import { PredictionManager } from './prediction';
import { RemoteMotion } from './remote-motion';
import { simulationStep } from '../shared/settings';
import { setCraftActionDispatcher } from './craft-actions';
import { type CraftAction } from '../shared/protocol/network';
import { shadesOf } from '../shared/colors';

// Use the same prediction horizon on every client. Input arrival timing also
// includes missed frames: using it to change this lead puts peers on different
// timelines throughout a turn or thrust, even after their clocks catch up.
const predictionTickLead = 1;
// How far the clock may wander before it is worth nudging, since the tick a
// snapshot was sent on is only ever a latency-blurred reading of it.
const driftSlack = 1;

const makeEntity = ({
  entity,
  world,
  previous,
}: {
  entity: ReplicatedEntity;
  world: SimulationWorld;
  previous?: GameObject;
}): GameObject => {
  const wirePosition = entity.position;
  const wireVelocity = entity.velocity || Vec.create();
  const common = {
    world,
    ...(entity.friction !== undefined && { friction: entity.friction }),
    ...(entity.health !== undefined && { health: entity.health }),
    ...(entity.label !== undefined && { label: entity.label }),
    ...(entity.message !== undefined && { message: entity.message }),
    id: entity.id,
    ...(entity.mass !== undefined && { mass: entity.mass }),
    pendingUpdateTime: entity.pendingUpdateTime ?? 0,
    position: Vec.clone(wirePosition),
    radius: entity.radius,
    rotation: entity.rotation,
    spin: entity.spin,
    velocity: Vec.clone(wireVelocity),
  };

  const withFriction = <T extends GameObject>(object: T): T => {
    object.friction =
      entity.friction ?? (object.constructor as typeof GameObject).friction;
    return object;
  };

  if (entity.kind === 'object') return withFriction(new GameObject(common));

  if (entity.kind === 'asteroid') {
    return withFriction(
      Object.assign(
        createAsteroid(world, {
          ...entity,
          ...common,
          contents: entity.contents || [],
          health: entity.health ?? entity.radius * 2,
          maxHealth: entity.maxHealth || entity.radius * 2,
        }),
        { pendingUpdateTime: common.pendingUpdateTime },
      ),
    );
  }

  if (entity.kind === 'item') {
    return withFriction(
      Object.assign(
        new itemTypes[entity.resource || 0]({
          world,
          id: common.id,
          position: common.position,
          velocity: common.velocity,
        }),
        common,
      ),
    );
  }
  const wreckage = entity.wreckage;

  if (entity.kind !== 'ship' && entity.kind !== 'station') {
    throw new Error('Unknown replicated entity kind');
  }
  const ship = Object.assign(
    wreckage
      ? createWreckage({
          properties: {
            ...common,
            world,
            decay: entity.decay,
            health: entity.health,
          },
          segments: wreckage,
        })
      : previous instanceof Craft &&
          !previous.decay &&
          ((entity.kind === 'station' && previous instanceof Station) ||
            (entity.kind === 'ship' && previous instanceof Ship))
        ? previous
        : entity.kind === 'station'
          ? createStation({
              ...common,
              world,
              ...(entity.shades && { shades: shadesOf(entity.shades) }),
            })
          : createShip(world, {
              ...common,
              ...(entity.shades && { shades: shadesOf(entity.shades) }),
            }),
    common,
    {
      dockedTo: entity.dockedTo,
      credits: entity.credits,
      health: entity.health ?? 100,
      ...(!wreckage && {
        ...(entity.hullHealth && { hullHealth: entity.hullHealth }),
      }),
      launching: entity.launching,
      paint: entity.paint,
      playerId: entity.playerId,
      thrust: entity.thrust ?? 0,
      turn: entity.turn ?? 0,
    },
  );

  ship.shades = entity.shades
    ? shadesOf(entity.shades)
    : (ship.constructor as typeof Craft).shades;
  ship.segments.forEach((segment) => {
    if (segment.hull) segment.shades = segment.module.shades || ship.shades;
  });
  ship.moduleStates = entity.modules || [];
  const modules = ship.modules;

  ship.cargoContents = (entity.cargoContents || []).map((object) =>
    'moduleIndex' in object
      ? modules[object.moduleIndex]
      : makeEntity({ entity: object, world }),
  );

  return withFriction(ship);
};

export class NetworkClient {
  readonly remoteMotion = new RemoteMotion();
  readonly events: SimulationEvent[] = [];
  readonly ready: Promise<void>;
  readonly world = createWorld();
  connected = false;
  playerId?: number;
  serverTick = 0;
  spawnPosition = Vec.create();
  shipId?: number;
  shipDestroyed = false;
  worldSeed?: number;
  private resolveReady!: () => void;
  private prediction = new PredictionManager({ world: this.world });
  // Separate from predicted objects: decoding must never mutate live state or
  // rollback history. Retain only the current interest set between packets.
  private authoritativeEntities = new Map<number, GameObject>();
  private entityRecords = new Map<number, ReplicatedEntity>();
  private socket!: WebSocket;
  private retryDelay = 500;
  private pendingSnapshot?: Extract<
    ServerMessage,
    { type: 'load' | 'snapshot' }
  >;
  private pendingEntities = new Map<
    number,
    { entity: ReplicatedEntity; tick: number }
  >();
  // Ticks still owed to (or borrowed from) the clock, paid off one per update.
  private tickAdjust = 0;
  private readonly tickLead = predictionTickLead;
  private welcomed = false;
  private inputTickStartedAt = performance.now();
  private pendingTime = 0;

  constructor({ url }: { url: string }) {
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.connect(url);
  }

  private showConnectionStatus(message?: string) {
    if (typeof document === 'undefined') return;
    const status = document.getElementById('connection-status');

    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  private connect(url: string) {
    this.showConnectionStatus('CONNECTING TO GAME...');
    const socket = new WebSocket(url);

    this.socket = socket;
    this.welcomed = false;
    socket.onopen = () =>
      this.send({
        playerToken: localStorage.getItem('playerToken'),
        type: 'hello',
      });
    socket.onmessage = ({ data }) => {
      try {
        this.receive({ message: JSON.parse(String(data)) as ServerMessage });
      } catch {
        socket.close(1007, 'Invalid server message');
      }
    };
    socket.onclose = ({ code }) => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.pendingTime = 0;
      this.events.length = 0;

      if (code === 4001) {
        this.showConnectionStatus('GAME OPEN IN ANOTHER TAB');
        return;
      }
      this.showConnectionStatus('CONNECTION LOST - RETRYING...');
      const delay = this.retryDelay * (0.8 + Math.random() * 0.4);

      this.retryDelay = Math.min(10000, this.retryDelay * 2);
      setTimeout(() => this.connect(url), delay);
    };
  }

  recordInput({ input }: { input: PlayerInput }) {
    if (!this.connected) return;
    this.prediction.recordInput({
      input,
      offset: (performance.now() - this.inputTickStartedAt) / 1000,
      send: (message) => this.send({ ...message, type: 'input' }),
    });
  }

  requestRespawn() {
    if (this.connected && this.shipDestroyed) this.send({ type: 'respawn' });
  }

  sendCraftAction(action: CraftAction) {
    if (!this.connected) return;
    this.send({ ...action, type: 'dock' });
  }

  predictFrame({ now = performance.now() }: { now?: number } = {}) {
    if (!this.connected) return this.world;
    return this.prediction.predictFrame({
      elapsed: (now - this.inputTickStartedAt) / 1000,
    });
  }

  updateFrame({
    input,
    dt,
    now = performance.now(),
  }: {
    input: PlayerInput;
    dt: number;
    now?: number;
  }) {
    if (!this.connected) return false;
    this.pendingTime += dt;
    const updated = this.pendingTime >= simulationStep;

    while (this.pendingTime >= simulationStep) {
      this.pendingTime -= simulationStep;
      this.update({ input, now: now - this.pendingTime * 1000 });
    }
    return updated;
  }

  update({
    input,
    now = performance.now(),
  }: {
    input: PlayerInput;
    now?: number;
  }) {
    if (!this.connected || this.playerId === undefined) return;
    const previousTick = this.world.tick;

    if (this.pendingSnapshot) {
      const message = {
        ...this.pendingSnapshot,
        fullEntities: [...this.pendingEntities.values()].map(
          ({ entity }) => entity,
        ),
      };
      const entityTicks = new Map(
        [...this.pendingEntities].map(([id, { tick }]) => [id, tick]),
      );

      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.applySnapshot({ message, entityTicks });
    }
    let steps = 1;

    if (this.tickAdjust > 0) {
      steps = 2;
      this.tickAdjust--;
    } else if (this.tickAdjust < 0) {
      steps = 0;
      this.tickAdjust++;
    }
    // Keep the same one-tick phase tolerance as retune(). Capping strictly at
    // the latest packet makes independent 30 Hz clocks alternate wait/catch-up.
    // Still bound frame debt after a stall; the target lead remains one tick.
    steps = Math.min(
      steps,
      Math.max(
        0,
        this.serverTick + this.tickLead + driftSlack - this.world.tick,
      ),
    );
    // A launch is said once, so a skipped tick must not swallow it.

    if (input.launch) steps ||= 1;

    const predictionInput: Parameters<PredictionManager['recordInput']>[0] = {
      input,
      send: (message) => this.send({ ...message, type: 'input' }),
    };

    // Releases must still reach the server while we wait for the next snapshot.
    this.prediction.recordInput(predictionInput);

    while (steps--) {
      this.events.push(...this.prediction.step(predictionInput));
      input.launch = false;
    }
    input.launch = false;
    // Keyboard edges and fractional prediction share the same tick boundary,
    // including the frame's remainder rather than rounding it away.

    if (this.world.tick !== previousTick) this.inputTickStartedAt = now;
  }

  takeEvents() {
    return this.events.splice(0);
  }

  /**
   * Keep the client's clock at the common prediction horizon. Missed frames
   * need clock catch-up, not a permanently larger prediction lead.
   */
  private retune() {
    const drift = this.serverTick + this.tickLead - this.world.tick;

    // Reconciliation handles large discontinuities using actual server state,
    // not by relabelling the tick of a still-predicted world.
    this.tickAdjust = Math.abs(drift) > driftSlack ? Math.sign(drift) : 0;
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    if (message.type === 'input') {
      const packet = [
        message.tick,
        message.sequence,
        packPlayerInput(message.input),
      ];

      if (message.offset) packet.push(message.offset);
      this.socket.send(JSON.stringify(packet));
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private receive({ message }: { message: ServerMessage }) {
    if (message.type === 'welcome') {
      this.world.entities.clear();
      this.world.players.clear();
      this.world.nextEntityId = 1;
      this.authoritativeEntities.clear();
      this.entityRecords.clear();
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.events.length = 0;
      this.remoteMotion.reset();
      this.prediction.reset();
      localStorage.setItem('playerToken', message.playerToken);
      this.playerId = message.playerId;
      this.shipId = message.shipId;
      Vec.set(this.spawnPosition, message.spawn);
      this.shipDestroyed = false;
      this.worldSeed = message.worldSeed;
      this.serverTick = message.serverTick;
      this.world.tick = message.serverTick + this.tickLead;
      this.world.random = createRandom(message.worldSeed);
      addPlayer(this.world, {
        id: message.playerId,
        shipId: message.shipId,
      });
      this.prediction.setLocalPlayer({ playerId: message.playerId });
      this.welcomed = true;
      return;
    }

    if (message.type === 'respawn') {
      this.shipId = message.shipId;
      this.shipDestroyed = false;
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.world.players.get(this.playerId!)!.shipId = message.shipId;
      return;
    }

    if (
      message.type === 'snapshot' &&
      message.serverTick < (this.pendingSnapshot?.serverTick ?? this.serverTick)
    ) {
      return;
    }

    if (message.type === 'load') this.entityRecords.clear();
    message.fullEntities = message.fullEntities.map((record) => {
      const previous = this.entityRecords.get(record.id);
      const full = { ...previous, ...record } as ReplicatedEntity;

      Object.entries(record).forEach(([key, value]) => {
        if (value === null) {
          delete (full as unknown as Record<string, unknown>)[key];
        }
      });
      this.entityRecords.set(record.id, full);
      return full;
    });
    message.entityIds ??= [...this.entityRecords.keys()];
    const visible = new Set(message.entityIds);

    this.entityRecords.forEach((_, id) => {
      if (!visible.has(id)) this.entityRecords.delete(id);
    });
    this.shipDestroyed = !message.entityIds.includes(this.shipId!);
    this.remoteMotion.receive({
      entities: message.fullEntities,
      entityIds: message.entityIds,
      shipId: this.shipId,
      tick: message.serverTick,
    });

    if (message.type === 'snapshot') {
      // Keep the latest update for each retained entity, not a queue of full
      // worlds to reconcile individually when the browser resumes.
      this.pendingSnapshot = message;
      message.fullEntities.forEach((entity) =>
        this.pendingEntities.set(entity.id, {
          entity,
          tick: message.serverTick,
        }),
      );
      const retained = new Set(message.entityIds);

      this.pendingEntities.forEach((_, id) => {
        if (!retained.has(id)) this.pendingEntities.delete(id);
      });
      return;
    }
    this.applySnapshot({ message });
  }

  private applySnapshot({
    message,
    entityTicks,
  }: {
    message: Extract<ServerMessage, { type: 'load' | 'snapshot' }>;
    entityTicks?: Map<number, number>;
  }) {
    this.serverTick = message.serverTick;

    if (message.type === 'load') {
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.authoritativeEntities.clear();
      this.prediction.reset();
      this.world.tick = this.serverTick;
    }

    const entities = message.fullEntities.map((entity) =>
      makeEntity({
        entity,
        world: this.world,
        previous: this.authoritativeEntities.get(entity.id),
      }),
    );
    const entityIds = message.entityIds;
    const retained = new Set(entityIds);

    this.authoritativeEntities.forEach((_, id) => {
      if (!retained.has(id)) this.authoritativeEntities.delete(id);
    });
    entities.forEach((entity) =>
      this.authoritativeEntities.set(entity.id, entity),
    );
    this.prediction.reconcile({
      entities,
      entityIds,
      entityTicks,
      tick: this.serverTick,
    });

    if (message.type === 'load') {
      this.prediction.replayTo({ targetTick: this.serverTick + this.tickLead });
      this.tickAdjust = 0;
      this.pendingTime = 0;
      this.inputTickStartedAt = performance.now();

      if (this.welcomed) {
        this.connected = true;
        this.retryDelay = 500;
        this.pendingTime = simulationStep;
        this.showConnectionStatus();
        this.resolveReady();
      }
    } else this.retune();
  }
}

const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

export const network = new NetworkClient({
  url: `${socketProtocol}//${location.host}/game-socket`,
});

setCraftActionDispatcher((action) => network.sendCraftAction(action));
