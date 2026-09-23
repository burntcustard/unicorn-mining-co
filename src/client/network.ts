import { Vector } from '../shared/vector';
import { type PlayerInput } from '../shared/protocol/input';
import { type SimulationEvent } from '../shared/protocol/events';
import {
  type ClientMessage,
  type ReplicatedEntity,
  type ServerMessage,
} from '../shared/protocol/network';
import { createRandom } from '../shared/seeded-random';
import { addPlayer, createWorld } from '../shared/simulation/world';
import { createAsteroid } from '../shared/simulation/asteroid';
import { createItem } from '../shared/items/create-item';
import { GameObject } from '../shared/game-object';
import { Craft } from '../shared/craft/craft';
import { Ship } from '../shared/craft/ship';
import { Station } from '../shared/craft/station';
import { createShip } from '../shared/craft/create-ship';
import { createWreckage } from '../shared/craft/create-wreckage';
import { createStation } from '../shared/craft/create-station';
import { type SimulationWorld } from '../shared/simulation/world';
import { type WorldObject } from '../shared/simulation/world';
import { PredictionManager } from './prediction';
import { RemoteMotion } from './remote-motion';
import { simulationStep } from '../shared/simulation/update-tier';
import { setCraftActionDispatcher } from './craft-actions';
import { type CraftAction } from '../shared/protocol/network';
import { paletteOf } from '../shared/colors';

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
  previous?: WorldObject;
}): WorldObject => {
  const wirePosition = entity.position;
  const wireVelocity = entity.velocity;
  const common = {
    world,
    ...(entity.health !== undefined && { health: entity.health }),
    ...(entity.label !== undefined && { label: entity.label }),
    id: entity.id,
    mass: entity.mass,
    pendingUpdateTime: entity.pendingUpdateTime,
    position: Vector(wirePosition.x, wirePosition.y),
    radius: entity.radius,
    rotation: entity.rotation,
    spin: entity.spin,
    velocity: Vector(wireVelocity.x, wireVelocity.y),
  };

  if (entity.kind === 'object') return new GameObject(common);

  if (entity.kind === 'asteroid') {
    return Object.assign(
      createAsteroid(world, {
        ...entity,
        ...common,
        contents: entity.contents || [],
        health: entity.health ?? entity.radius * 2,
        maxHealth: entity.maxHealth || entity.radius * 2,
      }),
      { pendingUpdateTime: common.pendingUpdateTime },
    );
  }

  if (entity.kind === 'item') {
    return Object.assign(
      createItem(world, {
        id: common.id,
        position: common.position,
        resource: entity.resource || 0,
        velocity: common.velocity,
      }),
      common,
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
          parts: wreckage,
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
              shades: entity.shades && paletteOf(entity.shades),
            })
          : createShip(world, {
              ...common,
              ...(entity.shades && { shades: paletteOf(entity.shades) }),
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

  if (entity.shades) ship.shades = paletteOf(entity.shades);
  ship.segments.forEach((part) => {
    if (part.hull) part.shades = part.module.shades || ship.shades;
  });
  ship.moduleStates = entity.modules || [];
  const modules = ship.modules;

  ship.cargoContents = (entity.cargoContents || []).map((object) =>
    'moduleIndex' in object
      ? modules[object.moduleIndex]
      : makeEntity({ entity: object, world }),
  );

  return ship;
};

export class NetworkClient {
  readonly remoteMotion = new RemoteMotion();
  readonly events: SimulationEvent[] = [];
  readonly ready: Promise<void>;
  readonly world = createWorld();
  playerId?: number;
  serverTick = 0;
  shipId?: number;
  worldSeed?: number;
  private resolveReady!: () => void;
  private prediction = new PredictionManager({ world: this.world });
  // Separate from predicted objects: decoding must never mutate live state or
  // rollback history. Retain only the current interest set between packets.
  private authoritativeEntities = new Map<number, WorldObject>();
  private socket: WebSocket;
  private pendingSnapshot?: Exclude<ServerMessage, { type: 'welcome' }>;
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
    this.socket = new WebSocket(url);
    this.socket.onopen = () =>
      this.send({
        playerToken: localStorage.getItem('playerToken'),
        type: 'hello',
      });
    this.socket.onmessage = ({ data }) =>
      this.receive({ message: JSON.parse(String(data)) as ServerMessage });
  }

  recordInput({ input }: { input: PlayerInput }) {
    this.prediction.recordInput({
      input,
      offset: (performance.now() - this.inputTickStartedAt) / 1000,
      send: (message) => this.send({ ...message, type: 'input' }),
    });
  }

  sendCraftAction(action: CraftAction) {
    this.send({ ...action, type: 'dock' });
  }

  predictFrame({ now = performance.now() }: { now?: number } = {}) {
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
    if (this.playerId === undefined) return;
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
    this.socket.send(JSON.stringify(message));
  }

  private receive({ message }: { message: ServerMessage }) {
    if (message.type === 'welcome') {
      localStorage.setItem('playerToken', message.playerToken);
      this.playerId = message.playerId;
      this.shipId = message.shipId;
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

    if (
      message.type === 'snapshot' &&
      message.serverTick < (this.pendingSnapshot?.serverTick ?? this.serverTick)
    ) {
      return;
    }
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
    message: Exclude<ServerMessage, { type: 'welcome' }>;
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

      if (this.welcomed) this.resolveReady();
    } else this.retune();
  }
}

const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

export const network = new NetworkClient({
  url: `${socketProtocol}//${location.host}/game-socket`,
});

setCraftActionDispatcher((action) => network.sendCraftAction(action));
