import { JumpGate } from '../objects/jump-gate';
import { Wormhole } from '../objects/wormhole';
import { Projectile } from '../objects/projectile';
import { type WeaponId } from '../../specs/modules';
import * as Vec from '../utilities/vector';
import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { playerInput } from '../input/input';
import { moduleControls } from '../objects/control-ship';
import { player, syncPaintUnlocks } from '../player';
import {
  encodeClientMessage,
  decodeServerControl,
  isPlayerToken,
} from '../protocol/binary-control';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
  snapshotAsteroidPositions,
  snapshotDeltaQuery,
} from '../protocol/binary-snapshot';
import { type SimulationEvent } from '../protocol/events';
import { type WorldSound } from '../protocol/sounds';
import {
  type ClientMessage,
  type ReplicatedEntity,
  type ServerMessage,
  type StationStockEntry,
} from '../protocol/network';
import { createRandom } from '../utilities/seeded-random';
import { addPlayer, createWorld } from '../simulation/world';
import { Asteroid, createAsteroid } from '../objects/asteroid';
import { Item } from '../objects/item';
import { autogunAmmo, itemTypes } from '../../specs/items';
import { GameObject } from '../objects/game-object';
import { Craft } from '../objects/craft';
import { Ship } from '../objects/ship';
import { Station } from '../objects/station';
import { stationSpecsById, type StationId } from '../../specs/stations';
import { NavBeacon } from '../objects/nav-beacon';
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
import { hangarState, setHangarActionDispatcher } from './hangar-actions';
import { type HangarAction } from '../protocol/network';
import { shipSpecsById } from '../../specs/ships';
import { MovementChannel } from './movement-channel';

const asteroidRecords = new WeakMap<Asteroid, ReplicatedEntity>();
const stationRecords = new WeakMap<Station, ReplicatedEntity>();
const stationPoseTicks = new WeakMap<ReplicatedEntity, number>();
const stockItems = new WeakMap<StationStockEntry, GameObject>();
const connectionStatusDelay = 1000;

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
    targetLabel: entity.targetLabel,
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
    const before =
      previous instanceof Asteroid && asteroidRecords.get(previous);
    const unchanged =
      before &&
      before.radius === entity.radius &&
      before.radiusEven === entity.radiusEven &&
      before.pointCount === entity.pointCount &&
      before.health === entity.health &&
      before.maxHealth === entity.maxHealth &&
      before.mass === entity.mass &&
      before.resource === entity.resource &&
      before.contents === entity.contents &&
      before.segments === entity.segments &&
      before.shapeOutline === entity.shapeOutline;

    // Motion deltas retain the wire model arrays. Keep their cut geometry and
    // collision caches; a model or damage update constructs another model.
    const asteroid = unchanged
      ? Object.assign(previous as Asteroid, common, { decay: entity.decay })
      : Object.assign(
          createAsteroid(world, {
            ...entity,
            ...common,
            contents: entity.contents || [],
            health: entity.health ?? entity.radius * 2,
            maxHealth: entity.maxHealth || entity.radius * 2,
          }),
          { pendingUpdateTime: common.pendingUpdateTime },
        ).lockGeometry();

    asteroidRecords.set(asteroid, entity);
    return withFriction(asteroid);
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

  if (entity.kind === 'jumpGate' || entity.kind === 'wormhole') {
    const Type = entity.kind === 'jumpGate' ? JumpGate : Wormhole;
    const portal = previous instanceof Type ? previous : new Type(common);

    return Object.assign(portal, common, {
      mass: Infinity,
      opening: entity.opening ?? 1,
      openingTarget: entity.openingTarget ?? 1,
      blockedBeams: entity.blockedBeams ?? 0,
      destinationName: entity.destinationName || '',
    });
  }

  const wreckage = entity.wreckage;

  if (
    entity.kind !== 'ship' &&
    entity.kind !== 'station' &&
    entity.kind !== 'navBeacon'
  ) {
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
          ((entity.kind === 'navBeacon' && previous instanceof NavBeacon) ||
            (entity.kind === 'station' && previous instanceof Station) ||
            (entity.kind === 'ship' && previous instanceof Ship))
        ? previous
        : entity.kind === 'navBeacon'
          ? new NavBeacon({ ...common, world })
          : entity.kind === 'station'
            ? new Station({
                ...common,
                stationType: entity.definitionId as StationId,
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
      ...(entity.storedPower !== undefined && {
        storedPower: entity.storedPower,
      }),
      dockedTo: entity.dockedTo,
      health: entity.health ?? 100,
      ...(!wreckage && {
        ...(entity.hullHealth && { hullHealth: entity.hullHealth }),
      }),
      launching: entity.launching,
      transitTime: entity.transitTime || 0,
      transitGate: entity.transitGate || 0,
      firing: !!entity.firing,
      hostile: !!entity.hostile,
      npcState: entity.npcState,
      paint: entity.paint,
      playerId: entity.playerId,
      thrust: entity.thrust ?? 0,
      turn: entity.turn ?? 0,
    },
  );

  if (ship instanceof Station) {
    const spec = stationSpecsById.get(
      (entity.definitionId || 'corral-5') as StationId,
    )!;

    ship.name = entity.name ?? spec.name;
    ship.mass = entity.mass ?? spec.mass;
    const before = stationRecords.get(ship);

    if (
      before &&
      before.shades === entity.shades &&
      before.modules === entity.modules &&
      before.cargoContents === entity.cargoContents &&
      before.stationStockEntries === entity.stationStockEntries
    ) {
      return withFriction(ship);
    }

    stationRecords.set(ship, entity);
  }

  ship.shades = entity.shades
    ? shadesOf(entity.shades)
    : (ship.constructor as typeof Craft).shades;

  ship.segments.forEach((segment) => {
    if (segment.hull) segment.shades = segment.module.shades || ship.shades;
  });

  const mountedModules = entity.modules || [];
  const stock = entity.stationStockEntries;

  ship.moduleStates = stock
    ? mountedModules.concat(
        stock.flatMap((entry) => ('module' in entry ? [entry.module] : [])),
      )
    : mountedModules;
  const modules = ship.modules;

  if (stock) {
    let moduleIndex = mountedModules.length;

    ship.cargoContents = stock.map((entry) => {
      if ('module' in entry) return modules[moduleIndex++];

      let item = stockItems.get(entry);

      if (!item) {
        item =
          'kind' in entry
            ? makeEntity({ entity: entry, world })
            : new Item(itemTypes[entry.resource], { world, id: entry.id });
        stockItems.set(entry, item);
      }

      return item;
    });
  } else {
    ship.cargoContents = (entity.cargoContents || []).map((object) =>
      'moduleIndex' in object
        ? modules[object.moduleIndex]
        : makeEntity({ entity: object, world }),
    );
  }

  return withFriction(ship);
};

export class NetworkClient {
  displayName = '';
  mapMarkers: import('../protocol/network').MapMarker[] = [];
  mapReady = false;
  asteroidPositions: Vec.Value[] = [];
  readonly authenticated: Promise<void>;
  private resolveAuthenticated!: () => void;
  private pendingProfile?: { resolve(): void; reject(error: Error): void };
  private deferred: boolean;
  private playing: boolean;
  private leaving = false;
  readonly player: Pick<typeof player, 'credits' | 'unlockedPaints'>;
  // Separate from predicted objects: decoding must never mutate live state or
  // rollback history. Retain only the current interest set between packets.
  private authoritativeEntities = new Map<number, GameObject>();
  private authoritativeCredits = 0;
  private acknowledgedDockSequence = 0;
  private dockSequence = 0;
  private dockIds = new Map<number, number>();
  private pendingDockActions: { sequence: number; action: CraftAction }[] = [];
  private hangarListPending = false;
  connected = false;
  private entityRecords = new Map<number, ReplicatedEntity>();
  private stockStationId = 0;
  readonly stationMarkers = new Map<number, ReplicatedEntity>();
  readonly events: SimulationEvent[] = [];
  readonly sounds: WorldSound[] = [];
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
  private changingDockedShip = false;
  playerId?: number;
  private prediction: PredictionManager;
  private worldReady: Promise<void>;
  get ready() {
    return this.worldReady;
  }
  readonly remoteMotion = new RemoteMotion();
  private resolveReady!: () => void;
  private retryDelay = 500;
  private connectionStatusTimer?: ReturnType<typeof setTimeout>;
  serverTick = 0;
  get shipDestroyed() {
    const ship = this.world.entities.get(this.shipId!);

    return this.connected && (ship ? ship.dead : !this.changingDockedShip);
  }
  get shipStranded() {
    const ship = this.world.entities.get(this.shipId!);

    return this.connected && ship instanceof Ship && ship.stranded;
  }

  chatMessages: Extract<ServerMessage, { type: 'chat' }>[] = [];

  sendChat(channel: number, text: string) {
    this.send({ type: 'chat', channel, text });
  }

  sectorMap(position: Vec.Value) {
    this.send({ type: 'sectorMap', position });
  }

  requestGateAccess(gateId: number) {
    this.send({ type: 'gateAccess', gateId });
  }

  shipId?: number;
  ownedShips?: Ship[];
  snapshotReceivedAt = 0;
  private readonly socketUrl: string;
  private socket!: WebSocket;
  private snapshotDeltas = true;
  private movementCapable = true;
  spawnPosition = Vec.create();
  private welcomed = false;
  readonly world = createWorld();
  worldSeed?: number;
  sectorName = '';

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

    if (message.type === 'load') this.stationMarkers.clear();

    const retained = new Set(message.entityIds);
    let entities: GameObject[] = [];

    this.stationMarkers.forEach((_, id) => {
      if (!retained.has(id)) this.stationMarkers.delete(id);
    });

    this.authoritativeEntities.forEach((_, id) => {
      if (!retained.has(id)) this.authoritativeEntities.delete(id);
    });

    message.fullEntities.forEach((entity) => {
      if (entity.stationMarker) {
        this.stationMarkers.set(entity.id, entity);
        this.authoritativeEntities.delete(entity.id);
        return;
      }

      this.stationMarkers.delete(entity.id);

      const model = makeEntity({
        entity,
        world: this.world,
        previous: this.authoritativeEntities.get(entity.id),
      });

      this.authoritativeEntities.set(entity.id, model);
      entities.push(model);
    });

    const entityIds = this.stationMarkers.size
      ? message.entityIds.filter((id) => !this.stationMarkers.has(id))
      : message.entityIds;

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

    this.changingDockedShip = false;

    if (!this.pendingDockActions.length) this.dockIds.clear();

    if (message.type === 'load') {
      this.pendingTime = 0;
      this.inputTickStartedAt = performance.now();
      const ship = this.world.entities.get(this.shipId!);

      if (ship instanceof Ship) {
        moduleControls.forEach(({ Type, input, writeInput }) =>
          writeInput({
            input: playerInput,
            active:
              input !== 'thrustBoost' && ship.moduleActive({ module: Type }),
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

  private connect() {
    const url = this.socketUrl;
    const snapshotDeltas = this.snapshotDeltas && url.endsWith('/game-socket');
    const movementCapable =
      snapshotDeltas &&
      this.movementCapable &&
      typeof RTCPeerConnection !== 'undefined';
    const socket = new WebSocket(
      snapshotDeltas
        ? `${url}?${snapshotDeltaQuery}${movementCapable ? '&movement=1' : ''}`
        : url,
    );
    let movement: MovementChannel | undefined;
    let opened = false;

    this.socket = socket;
    this.welcomed = false;
    this.leaving = false;
    socket.binaryType = 'arraybuffer';
    const handshakeTimer = setTimeout(() => socket.close(), 15000);

    socket.onopen = () => {
      opened = true;
      const storedToken = localStorage.getItem('playerToken');
      const playerToken = isPlayerToken(storedToken) ? storedToken : null;

      if (storedToken !== null && playerToken === null) {
        localStorage.removeItem('playerToken');
      }

      this.send({
        playerToken,
        type: this.deferred ? 'prepare' : 'hello',
      });
    };

    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;

      if (movementCapable && typeof data === 'string') {
        if (data === 'movement') {
          try {
            movement ??= new MovementChannel({
              sendOffer: (sdp) => {
                if (
                  this.socket === socket &&
                  socket.readyState === WebSocket.OPEN
                ) {
                  socket.send(`movement\n${sdp}`);
                }
              },
              receiveMovement: (samples) => {
                const tick = samples[0]?.tick;

                if (
                  this.socket === socket &&
                  this.connected &&
                  tick !== undefined &&
                  tick > this.serverTick &&
                  tick <= this.world.tick + 1
                ) {
                  this.remoteMotion.receiveMovement(samples);
                }
              },
            });
          } catch {
            // The game socket stays in use if WebRTC is unavailable.
          }

          return;
        }

        if (data.startsWith('movement\n')) {
          movement?.answer(data.slice(9));
          return;
        }
      }

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

        if (this.welcomed) clearTimeout(handshakeTimer);
      } catch (error) {
        // @ifdef DEBUG
        console.error('Could not process game server message:', error);
        // @endif
        socket.close(4004, 'Invalid server message');
      }
    };

    socket.onclose = ({ code, reason }) => {
      clearTimeout(handshakeTimer);
      movement?.close();

      if (this.socket !== socket) return;

      if (movementCapable && !opened && code === 1006) {
        this.movementCapable = false;
        this.connect();
        return;
      }

      // Older servers require the unmodified socket URL.
      if (snapshotDeltas && !opened && code === 1006) {
        this.snapshotDeltas = false;
        this.connect();
        return;
      }

      this.connected = false;
      this.remoteMotion.clearMovement();
      this.leaving = false;
      this.pendingProfile?.reject(
        new Error('Connection lost. Please try again.'),
      );
      this.pendingProfile = undefined;
      this.pendingTime = 0;
      this.events.length = 0;
      this.sounds.length = 0;
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
        this.showConnectionStatus(
          this.playing
            ? 'AWAY TOO LONG - RELOAD TO PLAY'
            : 'AWAY TOO LONG - PRESS PLAY TO RECONNECT',
        );
        return;
      }

      if (code === 4003) {
        this.showConnectionStatus(reason);
        return;
      }

      if (this.welcomed) {
        this.showConnectionStatus('CONNECTION LOST - RETRYING...', {
          delay: connectionStatusDelay,
        });
      }

      const delay = this.retryDelay * (0.8 + Math.random() * 0.4);

      this.retryDelay = Math.min(10000, this.retryDelay * 2);

      setTimeout(() => {
        if (this.socket === socket) this.connect();
      }, delay);
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
    this.socketUrl = url;
    this.deferred = deferred;
    this.playing = !deferred;
    this.prediction = new PredictionManager({ world: this.world });

    this.worldReady = new Promise((resolve) => (this.resolveReady = resolve));
    this.authenticated = new Promise(
      (resolve) => (this.resolveAuthenticated = resolve),
    );

    this.showConnectionStatus('CONNECTING TO GAME...', {
      delay: connectionStatusDelay,
    });

    this.connect();
  }

  enterWorld() {
    if (!this.playing) {
      this.playing = true;

      if (this.socket.readyState >= WebSocket.CLOSING) {
        this.showConnectionStatus('CONNECTING TO GAME...', {
          delay: connectionStatusDelay,
        });

        this.connect();
      } else if (this.welcomed && !this.leaving) {
        this.send({ type: 'play' });
      }
    }

    return this.ready;
  }

  leaveWorld() {
    this.playing = false;
    this.connected = false;
    this.remoteMotion.clearMovement();
    this.worldReady = new Promise((resolve) => (this.resolveReady = resolve));
    this.dockSequence = this.acknowledgedDockSequence = 0;
    this.leaving = this.welcomed && this.socket.readyState === WebSocket.OPEN;

    if (this.leaving) this.send({ type: 'leave' });
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

  get predictedShots() {
    return this.prediction.shots;
  }

  predictFrame({ now = performance.now() }: { now?: number } = {}) {
    if (!this.connected) return this.world;

    return this.prediction.predictFrame({
      elapsed: (now - this.inputTickStartedAt) / 1000,
    });
  }

  presentedPoses({
    now,
    predicted,
  }: {
    now: number;
    predicted: SimulationWorld;
  }) {
    if (this.remoteMotion.hasMovement) {
      this.remoteMotion.updateMovement({
        now,
        world: this.world,
        predicted,
        shipId: this.shipId,
        serverTick: this.serverTick,
        renderTick:
          this.world.tick +
          Math.max(
            0,
            Math.min(
              1,
              (now - this.inputTickStartedAt) / (simulationStep * 1000),
            ),
          ),
      });
    }

    return this.remoteMotion.sample({ now, world: this.world, predicted });
  }

  private receive({ message }: { message: ServerMessage }) {
    if (message.type === 'leave') {
      if (!this.leaving) return;

      this.leaving = false;

      if (this.playing) this.send({ type: 'play' });

      return;
    }

    // Wait for the server to finish leaving before accepting another world.
    if (this.leaving && message.type !== 'profile') return;

    if (message.type === 'hangar') {
      if (
        message.shipsForSale.some((offer) => !shipSpecsById.has(offer.ship))
      ) {
        throw new Error('Unknown hangar ship');
      }

      this.ownedShips = message.ships.map((entity) => {
        const ship = makeEntity({ entity, world: this.world });

        if (!(ship instanceof Ship)) throw new Error('Invalid hangar ship');
        return ship;
      });

      if (this.player === player) {
        hangarState.busy = false;
        hangarState.error = message.error;
        hangarState.shipsForSale = message.shipsForSale;
      }

      return;
    }

    if (message.type === 'sectorMap') {
      this.mapMarkers = message.mapMarkers;
      this.mapReady = true;
      return;
    }

    if (message.type === 'sounds') {
      if (this.connected) this.sounds.push(...message.sounds);
      return;
    }

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

    if (message.type === 'chat') {
      this.chatMessages = [...this.chatMessages.slice(-99), message];
      return;
    }

    if (message.type === 'welcome') {
      this.changingDockedShip = false;
      this.snapshotReceivedAt = 0;
      this.mapMarkers = [];
      this.mapReady = false;
      this.asteroidPositions = [];
      this.chatMessages = this.chatMessages.filter(
        ({ channel }) => channel === 1,
      );
      this.displayName = message.displayName || '';
      this.connected = false;
      syncPaintUnlocks(message.unlockedPaints, this.player.unlockedPaints);

      if (message.credits !== undefined) this.player.credits = message.credits;
      this.authoritativeCredits = this.player.credits;
      // Sector travel sends another welcome over the existing connection.
      // Keep its sequence so even requests still in flight cannot collide.

      const firstWelcome = !this.welcomed;

      if (firstWelcome) this.dockSequence = this.acknowledgedDockSequence = 0;
      this.dockIds.clear();
      this.pendingDockActions.length = 0;
      this.hangarListPending = false;
      this.ownedShips = undefined;

      if (this.player === player) {
        hangarState.busy = false;
        hangarState.error = '';
        hangarState.shipsForSale = undefined;
      }

      this.world.entities.clear();
      this.world.players.clear();
      this.world.nextEntityId = 1;
      this.authoritativeEntities.clear();
      this.entityRecords.clear();
      this.stationMarkers.clear();
      this.stockStationId = 0;
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.events.length = 0;
      this.sounds.length = 0;
      this.remoteMotion.reset();
      this.prediction.reset();
      localStorage.setItem('playerToken', message.playerToken);
      this.playerId = message.playerId;
      this.shipId = message.shipId;
      Vec.set(this.spawnPosition, message.spawn);
      this.worldSeed = message.worldSeed;
      this.sectorName = message.sectorName || 'Unknown';
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

        if (firstWelcome && this.playing) this.send({ type: 'play' });
      }

      return;
    }

    if (message.type === 'respawn') {
      const previous = this.world.entities.get(this.shipId!);

      this.changingDockedShip = Boolean(previous?.dockedTo && !previous.dead);
      this.mapMarkers = [];
      this.mapReady = false;
      this.asteroidPositions = [];
      this.shipId = message.shipId;
      this.pendingSnapshot = undefined;
      this.pendingEntities.clear();
      this.world.players.get(this.playerId!)!.shipId = message.shipId;
      this.pendingDockActions.length = 0;
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

    this.asteroidPositions = snapshotAsteroidPositions(
      message,
      this.asteroidPositions,
    );

    message.dockIds?.forEach(([from, to]) => this.dockIds.set(from, to));

    if (message.type === 'load') {
      this.entityRecords.clear();
      this.stockStationId = 0;
      this.remoteMotion.reset();
    }

    message.fullEntities = message.fullEntities.map((record) => {
      const previous = this.entityRecords.get(record.id);

      mergeModuleStates(record, previous);
      const full = { ...previous, ...record } as ReplicatedEntity;

      Object.entries(record).forEach(([key, value]) => {
        if (value === null) {
          delete (full as unknown as Record<string, unknown>)[key];
        }
      });

      this.entityRecords.set(record.id, full);

      if (full.kind === 'station') {
        stationPoseTicks.set(full, message.serverTick);
      }

      return full;
    });

    const visible = message.entityIds && new Set(message.entityIds);

    if (visible) {
      this.entityRecords.forEach((_, id) => {
        if (!visible.has(id)) this.entityRecords.delete(id);
      });
    }

    if (message.removedEntityIds) {
      for (const id of message.removedEntityIds) this.entityRecords.delete(id);
    }

    message.entityIds ??= [...this.entityRecords.keys()];

    if (message.stationStock) {
      const { stationId, replace, removedIds, entries } = message.stationStock;

      const updateStock = (
        id: number,
        stationStockEntries?: StationStockEntry[],
      ) => {
        const record = this.entityRecords.get(id);

        if (!record || record.kind !== 'station') return;

        const next = { ...record, stationStockEntries };
        const index = message.fullEntities.indexOf(record);

        this.entityRecords.set(id, next);
        // A stock patch keeps the pose from the last station record.
        stationPoseTicks.set(next, stationPoseTicks.get(record)!);

        if (index < 0) {
          message.fullEntities.push(next);
        } else {
          message.fullEntities[index] = next;
        }
      };

      if (this.stockStationId && this.stockStationId !== stationId) {
        updateStock(this.stockStationId);
      }

      if (stationId) {
        if (replace) {
          updateStock(stationId, entries);
        } else {
          const previous =
            this.entityRecords.get(stationId)?.stationStockEntries;

          if (!previous) throw new Error('Missing station stock baseline');
          const stock = new Map(previous.map((entry) => [entry.id, entry]));

          removedIds.forEach((id) => stock.delete(id));
          entries.forEach((entry) => stock.set(entry.id, entry));
          updateStock(stationId, [...stock.values()]);
        }
      }

      this.stockStationId = stationId;
    }

    if (this.hangarListPending) {
      this.sendHangarAction({ command: 'LIST', shipId: 0, value: '' });
    }

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
          tick:
            entity.kind === 'station'
              ? stationPoseTicks.get(entity)!
              : message.serverTick,
        }),
      );

      if (visible) {
        this.pendingEntities.forEach((_, id) => {
          if (!visible.has(id)) this.pendingEntities.delete(id);
        });
      }

      if (message.removedEntityIds) {
        for (const id of message.removedEntityIds) {
          this.pendingEntities.delete(id);
        }
      }

      return;
    }

    this.applySnapshot({ message });
  }

  recordInput({ input }: { input: PlayerInput }) {
    if (!this.connected) return;

    this.prediction.recordInput({
      input: this.ownedShips?.length === 0 ? emptyPlayerInput() : input,
      offset: (performance.now() - this.inputTickStartedAt) / 1000,
      send: (message) => this.send({ ...message, type: 'input' }),
    });
  }

  requestRespawn() {
    if (this.shipDestroyed || this.shipStranded) this.send({ type: 'respawn' });
  }

  sendHangarAction(action: HangarAction) {
    if (!this.connected || this.socket.readyState !== WebSocket.OPEN) {
      hangarState.busy = false;
      hangarState.error = 'Not connected to the server.';
      return;
    }

    if (action.command === 'LIST') {
      const ship = this.entityRecords.get(this.shipId!);

      this.hangarListPending = !ship?.dockedTo || Boolean(ship.launching);

      if (this.hangarListPending) return;
    }

    this.send({ type: 'hangar', ...action });
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

  private showConnectionStatus(message?: string, { delay = 0 } = {}) {
    if (typeof document === 'undefined') return;
    const status = document.getElementById('connection-status');

    if (!status) return;
    clearTimeout(this.connectionStatusTimer);

    const update = (statusMessage = '') => {
      status.hidden = statusMessage === '';
      status.textContent = statusMessage;
    };

    if (delay) {
      update();
      this.connectionStatusTimer = setTimeout(() => update(message), delay);
    } else {
      update(message);
    }
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
      input: this.ownedShips?.length === 0 ? emptyPlayerInput() : input,
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

  takeSounds() {
    return this.sounds.splice(0);
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
    const previousTick = this.world.tick;

    // A nearby snapshot can still exceed the last confirmed prediction horizon.
    // Adopt it directly rather than trying to step past that hard limit.
    const recovering =
      this.pendingSnapshot &&
      (Math.abs(this.pendingSnapshot.serverTick - this.world.tick) >
        maxPredictionTicks ||
        this.pendingSnapshot.serverTick > this.serverTick + maxPredictionTicks);

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

    // A decoded snapshot for a tick already reached can reconcile now, even
    // when this frame's rAF timestamp predates receipt. Waiting adds a frame
    // of input latency without protecting an earlier simulation boundary.
    const snapshotDue =
      this.pendingSnapshot &&
      (now + 1e-6 >= this.snapshotReceivedAt ||
        this.world.tick >= this.pendingSnapshot.serverTick);

    // Compare poses at the same tick, including a snapshot ahead of our clock.
    // Otherwise smoothing treats legitimate movement as a prediction error.
    if (!recovering && snapshotDue) {
      while (this.world.tick < this.pendingSnapshot.serverTick) {
        const tick = this.world.tick;

        this.step({ input, now: now - this.pendingTime * 1000 });

        if (this.world.tick === tick) break;
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

    const elapsed = (this.world.tick - previousTick) * simulationStep;

    if (elapsed > 0) {
      this.ownedShips?.forEach((ship) => {
        if (ship.dead || !ship.dockedTo || this.world.entities.has(ship.id)) {
          return;
        }

        ship.updatePower(elapsed);
        ship.updateModules(elapsed);
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

setHangarActionDispatcher((action) => network.sendHangarAction(action));
setCraftActionDispatcher((ship, action) =>
  network.applyCraftAction(ship, action),
);
