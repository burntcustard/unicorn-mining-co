import * as Vec from '../utilities/vector';
import { type PlayerInput } from '../protocol/input';
import {
  encodeClientMessage,
  decodeServerControl,
  isPlayerToken,
} from '../protocol/binary-control';
import { decodeBinarySnapshot } from '../protocol/binary-snapshot';
import { type SimulationEvent } from '../protocol/events';
import {
  type ClientMessage,
  type ReplicatedEntity,
  type ServerMessage,
} from '../protocol/network';
import { createRandom } from '../utilities/seeded-random';
import { addPlayer, createWorld } from '../simulation/world';
import { createAsteroid } from '../objects/asteroid';
import { Item } from '../objects/item';
import { itemTypes } from '../../definitions/items';
import { GameObject } from '../objects/game-object';
import { Craft } from '../objects/craft';
import { Ship } from '../objects/ship';
import { Station } from '../objects/station';
import { createShip } from '../objects/create-ship';
import { createWreckage } from '../objects/create-wreckage';
import { type SimulationWorld } from '../simulation/world';
import { PredictionManager } from '../prediction/prediction';
import { RemoteMotion } from '../prediction/remote-motion';
import { maxPredictionTicks } from '../../definitions/prediction';
import { simulationStep } from '../../definitions/simulation';
import { setCraftActionDispatcher } from './craft-actions';
import { type CraftAction } from '../protocol/network';
import { shadesOf } from '../../definitions/colors';

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
        new Item(itemTypes[entity.resource || 0], {
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
          previous.definitionId === entity.definitionId &&
          !previous.decay &&
          ((entity.kind === 'station' && previous instanceof Station) ||
            (entity.kind === 'ship' && previous instanceof Ship))
        ? previous
        : entity.kind === 'station'
          ? new Station({
              ...common,
              stationType:
                entity.definitionId as import('../../definitions/stations').StationId,
              world,
              ...(entity.shades && { shades: shadesOf(entity.shades) }),
            })
          : createShip(world, {
              ...common,
              shipType:
                entity.definitionId as import('../../definitions/ships').ShipId,
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
  // Separate from predicted objects: decoding must never mutate live state or
  // rollback history. Retain only the current interest set between packets.
  private authoritativeEntities = new Map<number, GameObject>();
  connected = false;
  private entityRecords = new Map<number, ReplicatedEntity>();
  readonly events: SimulationEvent[] = [];
  private inputTickStartedAt = performance.now();
  private pendingEntities = new Map<
    number,
    { entity: ReplicatedEntity; tick: number }
  >();
  private pendingSnapshot?: Extract<
    ServerMessage,
    { type: 'load' | 'snapshot' }
  >;
  private pendingTime = 0;
  playerId?: number;
  private prediction: PredictionManager;
  readonly ready: Promise<void>;
  readonly remoteMotion = new RemoteMotion();
  private resolveReady!: () => void;
  private retryDelay = 500;
  serverTick = 0;
  shipDestroyed = false;
  shipId?: number;
  private snapshotReceivedAt = performance.now();
  private socket!: WebSocket;
  spawnPosition = Vec.create();
  private welcomed = false;
  readonly world = createWorld();
  worldSeed?: number;

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
      nextEntityId: message.nextEntityId,
      tick: this.serverTick,
    });

    if (message.type === 'load') {
      this.pendingTime = 0;
      this.inputTickStartedAt = performance.now();

      if (this.welcomed) {
        this.connected = true;
        this.retryDelay = 500;
        this.showConnectionStatus();
        this.resolveReady();
      }
    }
  }

  private connect(url: string) {
    this.showConnectionStatus('CONNECTING TO GAME...');
    const socket = new WebSocket(url);

    this.socket = socket;
    this.welcomed = false;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      const storedToken = localStorage.getItem('playerToken');
      const playerToken = isPlayerToken(storedToken) ? storedToken : null;

      if (storedToken !== null && playerToken === null) {
        localStorage.removeItem('playerToken');
      }

      this.send({ playerToken, type: 'hello' });
    };

    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;

      try {
        if (!(data instanceof ArrayBuffer || data instanceof Uint8Array)) {
          throw new Error('Invalid server message');
        }

        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const message =
          bytes[0] === 0x55 && bytes[1] === 0x4d
            ? decodeBinarySnapshot(bytes)
            : decodeServerControl(bytes);

        this.receive({ message });
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

      if (code === 4002) {
        this.showConnectionStatus('AWAY TOO LONG - RELOAD TO PLAY');
        return;
      }

      this.showConnectionStatus('CONNECTION LOST - RETRYING...');
      const delay = this.retryDelay * (0.8 + Math.random() * 0.4);

      this.retryDelay = Math.min(10000, this.retryDelay * 2);
      setTimeout(() => this.connect(url), delay);
    };
  }

  constructor({ url }: { url: string }) {
    this.prediction = new PredictionManager({ world: this.world });

    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.connect(url);
  }

  predictFrame({ now = performance.now() }: { now?: number } = {}) {
    if (!this.connected) return this.world;

    return this.prediction.predictFrame({
      elapsed: (now - this.inputTickStartedAt) / 1000,
    });
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
      this.world.tick = message.serverTick;
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

    this.snapshotReceivedAt = performance.now();

    if (message.type === 'load') {
      this.entityRecords.clear();
      this.remoteMotion.reset();
    }

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
    // Receipt acknowledges decoded deltas, independent of render cadence.
    // The server can now replace skipped ticks with its latest state.

    if (message.snapshotSequence !== undefined) {
      this.send({ type: 'snapshotAck', sequence: message.snapshotSequence });
    }

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

  private send(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(encodeClientMessage(message));
  }

  sendCraftAction(action: CraftAction) {
    if (!this.connected) return;
    this.send({ ...action, type: 'dock' });
  }

  private showConnectionStatus(message?: string) {
    if (typeof document === 'undefined') return;
    const status = document.getElementById('connection-status');

    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  private step({
    input,
    now = performance.now(),
  }: {
    input: PlayerInput;
    now?: number;
  }) {
    if (!this.connected || this.playerId === undefined) return;

    const predictionInput: Parameters<PredictionManager['recordInput']>[0] = {
      input,
      send: (message) => this.send({ ...message, type: 'input' }),
    };

    // A missing packet never changes the speed of the local clock. Keep
    // responding through brief stalls, bounded by retained rollback history.
    this.prediction.recordInput(predictionInput);

    if (this.world.tick < this.serverTick + maxPredictionTicks) {
      this.events.push(...this.prediction.step(predictionInput));
      this.inputTickStartedAt = now;
    }

    input.launch = false;
  }

  takeEvents() {
    return this.events.splice(0);
  }

  update({
    input,
    now = performance.now(),
  }: {
    input: PlayerInput;
    now?: number;
  }) {
    return this.updateFrame({ input, now, dt: simulationStep });
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

    // Adopt snapshots beyond the prediction horizon without smoothing stale poses.
    const recovering =
      this.pendingSnapshot &&
      Math.abs(this.pendingSnapshot.serverTick - this.world.tick) >
        maxPredictionTicks;

    if (recovering) this.remoteMotion.reset();

    this.pendingTime += dt;
    let updated = this.pendingTime >= simulationStep;

    while (this.pendingTime >= simulationStep) {
      this.pendingTime -= simulationStep;

      this.step({
        input,
        now: now - this.pendingTime * 1000,
      });
    }

    // Catch up elapsed movement before preserving the current pose. A delayed
    // browser frame must not smooth away the distance it legitimately travelled.
    const before =
      !recovering &&
      this.pendingSnapshot &&
      now + 1e-6 >= this.snapshotReceivedAt
        ? this.remoteMotion.sample({
            now,
            world: this.world,
            predicted: this.predictFrame({ now }),
            shipId: this.shipId,
          })
        : undefined;

    before?.forEach((pose, id) =>
      Object.assign(pose, { dockedTo: this.world.entities.get(id)?.dockedTo }),
    );

    // Reconcile after clock catch-up, including frames shorter than a tick.
    // Never apply a fresh snapshot to an earlier catch-up boundary.

    if (this.pendingSnapshot && now + 1e-6 >= this.snapshotReceivedAt) {
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
      updated = true;
    }

    if (before) {
      this.remoteMotion.correct({
        before,
        now,
        world: this.world,
        predicted: this.predictFrame({ now }),
        shipId: this.shipId,
      });
    }

    return updated;
  }
}

const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

export const network = new NetworkClient({
  url: `${socketProtocol}//${location.host}/game-socket`,
});

setCraftActionDispatcher((action) => network.sendCraftAction(action));
