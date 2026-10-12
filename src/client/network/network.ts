import { Projectile } from '../objects/projectile';
import { type WeaponId } from '../../specs/modules';
import * as Vec from '../utilities/vector';
import { type PlayerInput } from '../protocol/input';
import { playerInput } from '../input/input';
import { moduleControls } from '../objects/control-ship';
import { player, syncPaintUnlocks } from '../player';
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
import { autogunAmmo, itemTypes } from '../../specs/items';
import { GameObject } from '../objects/game-object';
import { Craft } from '../objects/craft';
import { Ship } from '../objects/ship';
import { Station } from '../objects/station';
import { createShip } from '../objects/create-ship';
import { createWreckage } from '../objects/create-wreckage';
import { type SimulationWorld } from '../simulation/world';
import { PredictionManager } from '../prediction/prediction';
import { cloneEntity } from '../simulation/world-state';
import { RemoteMotion } from '../prediction/remote-motion';
import { maxPredictionTicks } from '../../specs/prediction';
import { simulationStep } from '../../specs/simulation';
import { setCraftActionDispatcher } from './craft-actions';
import { type CraftAction } from '../protocol/network';
import { shadesOf } from '../../specs/colors';

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
    ...(entity.name !== undefined && { name: entity.name }),
    ...(entity.message !== undefined && { message: entity.message }),
    ...(entity.rounds !== undefined && { rounds: entity.rounds }),
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

  if (entity.kind === 'projectile') {
    return new Projectile(entity.definitionId as WeaponId, {
      ...common,
      playerId: entity.playerId,
    });
  }

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
              cargoContents: [],
              stationType:
                entity.definitionId as import('../../specs/stations').StationId,
              world,
              ...(entity.shades && { shades: shadesOf(entity.shades) }),
            })
          : createShip(world, {
              ...common,
              shipType:
                entity.definitionId as import('../../specs/ships').ShipId,
              ...(entity.shades && { shades: shadesOf(entity.shades) }),
            }),
    common,
    {
      ...(entity.fuel !== undefined && { fuel: entity.fuel }),
      dockedTo: entity.dockedTo,
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
  displayName = '';
  readonly authenticated: Promise<void>;
  private resolveAuthenticated!: () => void;
  private pendingProfile?: { resolve(): void; reject(error: Error): void };
  private deferred: boolean;
  private playing: boolean;
  readonly player: Pick<typeof player, 'credits' | 'unlockedPaints'>;
  // Separate from predicted objects: decoding must never mutate live state or
  // rollback history. Retain only the current interest set between packets.
  private authoritativeEntities = new Map<number, GameObject>();
  private authoritativeCredits = 0;
  private acknowledgedDockSequence = 0;
  private dockSequence = 0;
  private dockIds = new Map<number, number>();
  private pendingDockActions: { sequence: number; action: CraftAction }[] = [];
  connected = false;
  private entityRecords = new Map<number, ReplicatedEntity>();
  readonly events: SimulationEvent[] = [];
  private inputTickStartedAt = performance.now();
  private lastActivitySentAt = -Infinity;
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
  get shipDestroyed() {
    const ship = this.world.entities.get(this.shipId!);

    return this.connected && (!ship || ship.dead);
  }
  get shipStranded() {
    const ship = this.world.entities.get(this.shipId!);

    return (
      this.connected &&
      ship instanceof Ship &&
      !ship.dead &&
      (!ship.engine.mount || ship.fuel <= 0) &&
      !ship.dockedTo &&
      !ship.launching
    );
  }
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

    let entities = message.fullEntities.map((entity) =>
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

    if (message.acknowledgedDockSequence !== undefined) {
      this.acknowledgedDockSequence = message.acknowledgedDockSequence;
      this.pendingDockActions = this.pendingDockActions.filter(
        ({ sequence }) => sequence > this.acknowledgedDockSequence,
      );
    }

    if (message.credits !== undefined) {
      this.authoritativeCredits = message.credits;
    }

    const account = { credits: this.authoritativeCredits };

    if (this.pendingDockActions.length) {
      // Rebuild the prediction from decoded server state, then replay only
      // actions the server has not processed. Never replay over live stock.
      const copies = new Map(this.authoritativeEntities);
      const own = copies.get(this.shipId!);

      if (own instanceof Ship) {
        const ship = cloneEntity({ entity: own }) as Ship;
        const station = copies.get(ship.dockedTo);

        copies.set(ship.id, ship);

        if (station) {
          copies.set(station.id, cloneEntity({ entity: station }));
        }

        ship.world = {
          ...this.world,
          entities: copies,
          nextEntityId: message.nextEntityId,
        };

        this.pendingDockActions.forEach(({ action }) =>
          ship.applyDockAction(this.resolveDockAction(action), account),
        );
        const projected = [ship, copies.get(ship.dockedTo)].filter(
          (entity): entity is GameObject => Boolean(entity),
        );

        entities = entities.filter(
          (entity) => !projected.some((copy) => copy.id === entity.id),
        );
        entities.push(...projected);
      }
    }

    this.player.credits = account.credits;

    this.prediction.reconcile({
      entities,
      entityIds,
      entityTicks,
      nextEntityId: message.nextEntityId,
      tick: this.serverTick,
    });

    if (!this.pendingDockActions.length) this.dockIds.clear();

    if (message.type === 'load') {
      this.pendingTime = 0;
      this.inputTickStartedAt = performance.now();
      const ship = this.world.entities.get(this.shipId!);

      if (ship instanceof Ship) {
        moduleControls.forEach(({ Type, writeInput }) =>
          writeInput({
            input: playerInput,
            active: ship.moduleActive({ module: Type }),
          }),
        );
      }

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

      this.send({ playerToken, type: this.deferred ? 'prepare' : 'hello' });
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
      this.pendingProfile?.reject(
        new Error('Connection lost. Please try again.'),
      );
      this.pendingProfile = undefined;
      this.pendingTime = 0;
      this.events.length = 0;
      this.pendingDockActions.length = 0;
      this.player.credits = this.authoritativeCredits;

      this.prediction.reconcile({
        entities: [...this.authoritativeEntities.values()],
        tick: this.serverTick,
      });

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

  constructor({
    url,
    deferred = false,
    player: state = { credits: 0, unlockedPaints: [] },
  }: {
    url: string;
    deferred?: boolean;
    player?: Pick<typeof player, 'credits' | 'unlockedPaints'>;
  }) {
    this.player = state;
    this.deferred = deferred;
    this.playing = !deferred;
    this.prediction = new PredictionManager({ world: this.world });

    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.authenticated = new Promise(
      (resolve) => (this.resolveAuthenticated = resolve),
    );
    this.connect(url);
  }

  enterWorld() {
    if (!this.playing) {
      this.playing = true;

      if (this.welcomed) this.send({ type: 'play' });
    }

    return this.ready;
  }

  async createProfile(displayName: string) {
    await this.authenticated;

    if (!this.welcomed || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Connecting to the server. Please try again.');
    }

    const packet = encodeClientMessage({ type: 'profile', displayName });

    return new Promise<void>((resolve, reject) => {
      this.pendingProfile = { resolve, reject };
      this.socket.send(packet);
    });
  }

  predictFrame({ now = performance.now() }: { now?: number } = {}) {
    if (!this.connected) return this.world;

    return this.prediction.predictFrame({
      elapsed: (now - this.inputTickStartedAt) / 1000,
    });
  }

  private receive({ message }: { message: ServerMessage }) {
    if (message.type === 'profile') {
      this.displayName = message.displayName;
      this.pendingProfile?.resolve();
      this.pendingProfile = undefined;
      return;
    }

    if (message.type === 'progress') {
      syncPaintUnlocks(message.unlockedPaints, this.player.unlockedPaints);

      // Sequenced snapshots carry balance and inventory together. A progress
      // control can arrive before the snapshot that confirms a trade.
      if (!this.dockSequence && message.credits !== undefined) {
        this.authoritativeCredits = message.credits;
        this.player.credits = message.credits;
      }

      return;
    }

    if (message.type === 'welcome') {
      this.displayName = message.displayName || '';
      this.connected = false;
      syncPaintUnlocks(message.unlockedPaints, this.player.unlockedPaints);

      if (message.credits !== undefined) this.player.credits = message.credits;
      this.authoritativeCredits = this.player.credits;
      this.dockSequence = this.acknowledgedDockSequence = 0;
      this.dockIds.clear();
      this.pendingDockActions.length = 0;
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
      this.resolveAuthenticated();

      if (this.deferred) {
        this.retryDelay = 500;
        this.showConnectionStatus();

        if (this.playing) this.send({ type: 'play' });
      }

      return;
    }

    if (message.type === 'respawn') {
      this.shipId = message.shipId;
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.world.players.get(this.playerId!)!.shipId = message.shipId;
      return;
    }

    if (
      (message.type === 'snapshot' &&
        message.serverTick <
          (this.pendingSnapshot?.serverTick ?? this.serverTick)) ||
      (message.acknowledgedDockSequence !== undefined &&
        message.acknowledgedDockSequence <
          (this.pendingSnapshot?.acknowledgedDockSequence ??
            this.acknowledgedDockSequence))
    ) {
      return;
    }

    this.snapshotReceivedAt = performance.now();
    message.dockIds?.forEach(([from, to]) => this.dockIds.set(from, to));

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
    if (this.shipDestroyed || this.shipStranded) this.send({ type: 'respawn' });
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(encodeClientMessage(message));
  }

  sendCraftAction(action: CraftAction) {
    if (!this.connected) return;
    const sequence = ++this.dockSequence;

    this.pendingDockActions.push({ sequence, action });
    this.send({ ...this.resolveDockAction(action), sequence, type: 'dock' });
  }

  private resolveDockAction(action: CraftAction): CraftAction {
    const resolve = (id: number) => {
      for (let count = 0; count < this.dockIds.size; count++) {
        const next = this.dockIds.get(id);

        if (next === undefined) break;
        id = next;
      }

      return id;
    };

    return action.action === 'sell' || action.action === 'buyStock'
      ? { ...action, objectIds: action.objectIds.map(resolve) }
      : 'moduleId' in action &&
          action.moduleId !== undefined &&
          action.action !== 'buy'
        ? { ...action, moduleId: resolve(action.moduleId) }
        : action;
  }

  applyCraftAction(ship: Ship, action: Parameters<Ship['applyDockAction']>[0]) {
    if (!this.connected || this.socket.readyState !== WebSocket.OPEN) return;

    if (action.action === 'buyAmmo') {
      const station = this.world.entities.get(ship.dockedTo) as
        | Craft
        | undefined;
      const item = station?.cargoContents.find(
        (object) => object.item === autogunAmmo,
      );

      if (!item) return;
      action = { action: 'buyStock', objectIds: [item.id] };
    }

    const applied = ship.applyDockAction(action, this.player);

    if (applied) {
      if (applied.action === 'buy') this.dockIds.delete(applied.moduleId);
      this.prediction.invalidateFrame();
      this.sendCraftAction(applied);
    }

    return applied;
  }

  sendActivity({ now = performance.now() }: { now?: number } = {}) {
    if (!this.welcomed || now - this.lastActivitySentAt < 30_000) return;
    this.lastActivitySentAt = now;
    this.send({ type: 'activity' });
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

    const snapshotDue =
      this.pendingSnapshot && now + 1e-6 >= this.snapshotReceivedAt;

    // Compare poses at the same tick, including a snapshot ahead of our clock.
    // Otherwise smoothing treats legitimate movement as a prediction error.
    if (!recovering && snapshotDue) {
      while (this.world.tick < this.pendingSnapshot.serverTick) {
        this.step({ input, now: now - this.pendingTime * 1000 });
      }
    }

    const predictedBefore =
      !recovering && snapshotDue ? this.predictFrame({ now }) : undefined;

    const before =
      predictedBefore &&
      this.remoteMotion.sample({
        now,
        world: this.world,
        predicted: predictedBefore,
        shipId: this.shipId,
      });

    before?.forEach((pose, id) => {
      const entity =
        predictedBefore?.entities.get(id) || this.world.entities.get(id);

      Object.assign(pose, {
        dockedTo: entity?.dockedTo,
        kind: entity?.kind,
        shapeOutline: entity?.shapeOutline,
      });
    });

    // Reconcile after clock catch-up, including frames shorter than a tick.
    // Never apply a fresh snapshot to an earlier catch-up boundary.

    if (snapshotDue) {
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
  player,
  deferred: true,
  url: `${socketProtocol}//${location.host}/game-socket`,
});

setCraftActionDispatcher((ship, action) =>
  network.applyCraftAction(ship, action),
);
