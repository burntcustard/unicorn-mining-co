import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import type { ProtocolRuntime } from '../utilities/protocol-runtime.ts';
import type {
  ClientMessage,
  CraftAction,
  ReplicatedEntity,
} from '../../src/client/protocol/network.ts';
import type { PlayerInput } from '../../src/client/protocol/input.ts';
import type { WorldSound } from '../../src/client/protocol/sounds.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import {
  compatibleWeaponMount,
  dockingControls,
  headingControls,
  neutralInput,
  wrappedAngle,
} from '../utilities/ship-controls.ts';
import {
  summarizeSnapshotTraffic,
  distribution,
  type SnapshotTrafficMessage,
} from '../utilities/snapshot-traffic-metrics.ts';
import {
  isOrdinaryAmmoItem,
  miningAreaContains,
  miningApproach,
  miningDrillSafe,
  miningTargetContained,
  obstacleSafeRoute,
  obstacleRadius,
  proposeMiningTargets,
  proposeSpreadCorridors,
  spreadCorridorClear,
  spreadCorridorDeviation,
  spreadRemainingDistance,
  weaponForClient,
  weaponClearAhead,
  weaponStagingControls,
  workloadControls,
  type ProtocolWorkload,
  type SpreadCorridor,
} from './workloads.ts';

/*
 * Multi-piece rocks carry segment health; single-piece fragments carry the
 * normal entity health field instead.
 */
export const replicatedAsteroidHealth = (entity: ReplicatedEntity) =>
  entity.segments?.reduce((sum, segment) => sum + segment.health, 0) ??
  entity.health;

/*
 * The normal split/destroy sound retains the responsible player even when a
 * rock disappears between snapshots. Its source can be drilling or collision.
 */
export const ownMiningFracture = ({
  sound,
  playerId,
  drilling,
  anchor,
  targetIds,
}: {
  sound: WorldSound;
  playerId: number;
  drilling: boolean;
  anchor?: Vec.Value;
  targetIds?: Set<number>;
}) =>
  !!anchor &&
  drilling &&
  sound.effect === 4 &&
  sound.by === playerId &&
  (targetIds?.has(sound.id) ||
    miningAreaContains({
      position: sound.position,
      anchor,
    }));

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ProtocolClient {
  readonly options: {
    url: string;
    index: number;
    players: number;
    runtime: ProtocolRuntime;
    preparationTimeoutMs?: number;
  };
  readonly entities = new Map<number, ReplicatedEntity>();
  readonly traffic: SnapshotTrafficMessage[] = [];
  readonly errors: string[] = [];
  readonly decodeMs: number[] = [];
  readonly projectileIds = new Map<string, Set<number>>();
  readonly socket: WebSocket;
  asteroidPositions: Vec.Value[] = [];
  miningAnchor: Vec.Value;
  miningAsteroidId: number;
  miningTargetIds = new Set<number>();
  spreadCorridor: SpreadCorridor;
  shipId = 0;
  playerId = 0;
  worldSeed: number;
  spawn: Vec.Value;
  sectorName: string;
  credits = 0;
  tick = 0;
  tickAt = 0;
  inputLead = 0;
  sequence = 0;
  acknowledgedDock = 0;
  dockSequence = 0;
  lastInput = neutralInput();
  measuring = false;
  requestedReceipts = 0;
  sentReceipts = 0;
  activeSnapshots = 0;
  firingSnapshots = 0;
  cooldownSnapshots = 0;
  chargeSnapshots = 0;
  fireCooldownStarts = 0;
  minPower = Infinity;
  maxPower = -Infinity;
  ammoStart = 0;
  minimumAmmo = Infinity;
  deaths = 0;
  missingShipSnapshots = 0;
  closedUnexpectedly = false;
  closing = false;
  private welcomed = false;
  private receiptFailures = 0;
  private previousTick = 0;
  private tickGaps: number[] = [];
  private lastActivity = 0;
  private started = false;
  private startPosition = Vec.create();
  private maximumDisplacement = 0;
  private movingSnapshots = 0;
  private maximumCorridorDeviation = 0;
  private maximumMiningAnchorDistance = 0;
  private minimumPeerSurfaceGap = Infinity;
  private minimumAsteroidSurfaceGap = Infinity;
  private drillSnapshots = 0;
  private hatchSnapshots = 0;
  private lightSnapshots = 0;
  private asteroidDamageChanges = 0;
  private assignedAsteroidDamageChanges = 0;
  private minimumAssignedAsteroidSurfaceGap = Infinity;
  private asteroidHealth = new Map<number, number>();
  private snapshotBytes = 0;
  private controlBytes = 0;
  private sentBytes = 0;
  private provisioned: Record<string, unknown>;
  private pendingReceiptWrites = new Set<number>();
  private nextReceiptWrite = 0;
  private receiptWritesCompleted = 0;
  private maximumBufferedBytes = 0;
  private previousFireCooldown: number;
  private fireHeldSince = 0;
  private fireHeldMs = 0;
  private premeasurementFireHeldMs = 0;
  private requiredModules: { id?: number; type: number; mount: number }[] = [];
  private missingModuleSnapshots = 0;
  private drillingInputSnapshots = 0;
  private drillingSuppressedSnapshots = 0;
  private miningFractures: (WorldSound & {
    at: number;
    boundTarget: boolean;
  })[] = [];
  private miningReplans: { id: number; reason: string; at: number }[] = [];
  private miningEnabled = false;
  private flyoutStartedAt = 0;
  private flyoutStartedPosition: Vec.Value;
  private weaponFlyout: {
    startedAt: number;
    endedAt: number;
    startPosition: Vec.Value;
    endPosition: Vec.Value;
    displacement: number;
  };
  private firstRequiredModuleLoss: Record<string, unknown>;
  private recentDamageSounds: (WorldSound & { at: number })[] = [];
  private weaponSettling: Record<string, unknown>;
  private miningApproachSamples: Record<string, unknown>[] = [];
  private miningApproachSampleAt = 0;
  private miningBestAnchorDistance = Infinity;
  private miningBestTargetDistance = new Map<number, number>();

  constructor(options: {
    url: string;
    index: number;
    players: number;
    runtime: ProtocolRuntime;
    preparationTimeoutMs?: number;
  }) {
    this.options = options;
    const target = new URL('/game-socket', options.url);

    target.protocol = ['https:', 'wss:'].includes(target.protocol)
      ? 'wss:'
      : 'ws:';
    this.socket = new WebSocket(target, { perMessageDeflate: false });
    this.socket.on('open', () =>
      this.send({ type: 'hello', playerToken: null }),
    );
    this.socket.on('error', (error) => this.errors.push(String(error)));

    this.socket.on('close', (code, reason) => {
      if (!this.closing) {
        this.closedUnexpectedly = true;
        this.errors.push(
          `Unexpected WebSocket close ${code} at ${new Date().toISOString()}${reason.length ? `: ${reason.toString()}` : ''}`,
        );
      }
    });

    this.socket.on('message', (raw, binary) => {
      const began = performance.now();

      try {
        assert(binary, 'Expected a binary game message');
        const bytes = raw as Buffer;
        const message =
          bytes[1] === 0x43
            ? options.runtime.decodeServerControl(bytes)
            : options.runtime.decodeBinarySnapshot(bytes);

        if (this.measuring) {
          if (message.type === 'snapshot' || message.type === 'load') {
            this.snapshotBytes += bytes.length;
          } else {
            this.controlBytes += bytes.length;
          }
        }

        if (message.type === 'sounds') {
          for (const sound of message.sounds) {
            if (
              (sound.effect === 3 || sound.effect === 4) &&
              (sound.by === this.playerId ||
                (this.ship &&
                  Vec.distance(sound.position, this.ship.position) < 500))
            ) {
              this.recentDamageSounds.push({ ...sound, at: performance.now() });

              if (this.recentDamageSounds.length > 24) {
                this.recentDamageSounds.shift();
              }
            }

            if (
              ownMiningFracture({
                sound,
                playerId: this.playerId,
                drilling: !!this.lastInput.hornDrill,
                anchor: this.miningAnchor,
                targetIds: this.miningTargetIds,
              })
            ) {
              if (this.measuring) {
                this.miningFractures.push({
                  ...sound,
                  at: performance.now(),
                  boundTarget: this.miningTargetIds.has(sound.id),
                });
              }
            }
          }

          return;
        }

        if (message.type === 'welcome') {
          this.welcomed = true;
          this.shipId = message.shipId;
          this.playerId = message.playerId;
          this.worldSeed = message.worldSeed;
          this.spawn = Vec.clone(message.spawn);
          this.sectorName = message.sectorName;
          this.tick = message.serverTick;
          this.tickAt = performance.now();
          this.credits = message.credits ?? this.credits;

          this.send({
            type: 'profile',
            displayName: `CPU benchmark ${options.index + 1}`,
          });

          return;
        }

        if (message.type === 'respawn') {
          this.deaths++;
          this.shipId = message.shipId;
        }

        if (message.type !== 'snapshot' && message.type !== 'load') return;
        const at = performance.now();

        this.traffic.push({
          at,
          type: message.type,
          snapshotSequence: message.snapshotSequence,
          acknowledgedSequence: message.acknowledgedSequence,
          serverTick: message.serverTick,
        });

        if (!this.started && this.traffic.length > 100) {
          this.traffic.splice(0, this.traffic.length - 50);
        }

        this.tick = message.serverTick;
        this.tickAt = at;
        this.inputLead = message.inputLead ?? this.inputLead;
        this.credits = message.credits ?? this.credits;

        if (message.asteroidPositions) {
          this.asteroidPositions = message.asteroidPositions;
        } else if (message.type === 'load') {
          this.asteroidPositions = [];
        }

        this.acknowledgedDock =
          message.acknowledgedDockSequence ?? this.acknowledgedDock;

        if (this.measuring && this.previousTick) {
          this.tickGaps.push(message.serverTick - this.previousTick);
        }

        this.previousTick = message.serverTick;
        const previousShip = this.ship;

        if (message.type === 'load') this.entities.clear();

        for (const record of message.fullEntities) {
          const entity = {
            ...this.entities.get(record.id),
            ...record,
          } as ReplicatedEntity;

          for (const [key, value] of Object.entries(record)) {
            if (value === null) {
              delete (entity as unknown as Record<string, unknown>)[key];
            }
          }

          this.entities.set(record.id, entity);
        }

        if (message.entityIds) {
          const retained = new Set(message.entityIds);

          for (const id of this.entities.keys()) {
            if (!retained.has(id)) this.entities.delete(id);
          }
        }

        if (
          this.requiredModules.length &&
          !this.loadoutIntact &&
          !this.firstRequiredModuleLoss
        ) {
          const pose = (ship: ReplicatedEntity) =>
            ship && {
              position: ship.position,
              rotation: ship.rotation,
              velocity: ship.velocity,
              firing: ship.firing,
              modules: ship.modules?.map(({ id, type, mount, health }) => ({
                id,
                type,
                mount,
                health,
              })),
            };

          this.firstRequiredModuleLoss = {
            receivedAt: at,
            serverTick: message.serverTick,
            previous: pose(previousShip),
            current: pose(this.ship),
            sounds: this.recentDamageSounds.slice(),
            nearbyObstacles: this.ship
              ? [...this.entities.values()]
                  .filter(
                    (entity) =>
                      entity.id !== this.shipId &&
                      ['asteroid', 'station', 'ship'].includes(entity.kind),
                  )
                  .map((entity) => ({
                    id: entity.id,
                    kind: entity.kind,
                    position: entity.position,
                    radius: entity.radius,
                    surfaceGap:
                      Vec.distance(entity.position, this.ship.position) -
                      entity.radius -
                      this.ship.radius,
                  }))
                  .toSorted((a, b) => a.surfaceGap - b.surfaceGap)
                  .slice(0, 4)
              : [],
            note: 'Adjacent authoritative snapshots and received normal sound events locate the first observed fitted-part loss; they do not identify an exact collision or blast callback.',
          };
        }

        if (message.snapshotSequence !== undefined) {
          if (this.measuring) this.requestedReceipts++;

          if (
            this.send({
              type: 'snapshotAck',
              sequence: message.snapshotSequence,
            })
          ) {
            if (this.measuring) this.sentReceipts++;
          } else if (this.measuring) {
            this.receiptFailures++;
          }
        }

        if (this.measuring) this.observeWeapons();
      } catch (error) {
        this.errors.push(
          error instanceof Error ? error.message : JSON.stringify(error),
        );
      } finally {
        if (this.measuring) this.decodeMs.push(performance.now() - began);
      }
    });
  }

  get ship() {
    return this.entities.get(this.shipId);
  }

  get miningAsteroid() {
    if (!this.miningAnchor || !this.ship) return undefined;
    const bound = this.entities.get(this.miningAsteroidId);

    const owned = (position: Vec.Value) =>
      this.miningAnchor &&
      miningAreaContains({
        position,
        anchor: this.miningAnchor,
      });

    const nearbyShips = [...this.entities.values()].filter(
      (entity) => entity.kind === 'ship' && entity.id !== this.shipId,
    );
    const blocked = (entity: ReplicatedEntity) =>
      nearbyShips.some(
        (other) =>
          Vec.distance(entity.position, other.position) <
          entity.radius + other.radius + 120,
      );

    const viable = (entity: ReplicatedEntity) => {
      const health = entity && replicatedAsteroidHealth(entity);

      return (
        entity?.kind === 'asteroid' &&
        owned(entity.position) &&
        !entity.decay &&
        entity.radius >= 15 &&
        (health === undefined || health > 0) &&
        miningTargetContained({
          ship: this.ship,
          asteroid: entity,
          anchor: this.miningAnchor,
          drillTip: this.drillTip,
        }) &&
        !blocked(entity)
      );
    };

    if (viable(bound)) return bound;

    if (this.miningAsteroidId !== undefined) {
      this.miningReplans.push({
        id: this.miningAsteroidId,
        reason:
          bound && blocked(bound)
            ? 'occupied-by-another-hull'
            : 'target-depleted-or-unavailable',
        at: performance.now(),
      });

      this.miningAsteroidId = undefined;
    }

    const asteroid = [...this.entities.values()]
      .filter(viable)
      .toSorted(
        (a, b) =>
          Vec.distance(
            a.position,
            this.miningTargetIds.size ? this.ship.position : this.miningAnchor,
          ) -
          (this.miningTargetIds.size ? a.radius : 0) -
          (Vec.distance(
            b.position,
            this.miningTargetIds.size ? this.ship.position : this.miningAnchor,
          ) -
            (this.miningTargetIds.size ? b.radius : 0)),
      )[0];

    if (asteroid) {
      this.miningAsteroidId = asteroid.id;
      this.miningTargetIds.add(asteroid.id);
    }

    return asteroid;
  }

  retainLoadout() {
    this.requiredModules = this.ship.modules.map(({ id, type, mount }) => ({
      id,
      type,
      mount,
    }));

    this.firstRequiredModuleLoss = undefined;
  }

  get drillTip() {
    const catalog = this.options.runtime.catalog;
    const module = this.ship?.modules?.find(
      (module) => module.type === catalog.moduleIds.indexOf('hornDrill'),
    );

    return (
      module &&
      catalog.ships[this.ship.definitionId || 'mustang']?.drillTipsByMount?.[
        module.mount
      ]
    );
  }

  beginFlyout() {
    this.flyoutStartedAt = Date.now();
    this.flyoutStartedPosition = Vec.clone(this.ship.position);
  }

  finishFlyout() {
    this.weaponFlyout = {
      startedAt: this.flyoutStartedAt,
      endedAt: Date.now(),
      startPosition: this.flyoutStartedPosition,
      endPosition: Vec.clone(this.ship.position),
      displacement: Vec.distance(
        this.flyoutStartedPosition,
        this.ship.position,
      ),
    };
  }

  recordMiningApproach() {
    const at = performance.now();

    if (
      !this.miningAnchor ||
      this.miningEnabled ||
      at - this.miningApproachSampleAt < 5000
    ) {
      return;
    }

    this.miningApproachSampleAt = at;
    const ship = this.ship;
    const asteroid = this.entities.get(this.miningAsteroidId);

    if (!ship || !asteroid) return;

    const approach = miningApproach({
      ship,
      asteroid,
      drillTip: this.drillTip,
    });

    const aim = approach.aim;

    const route = obstacleSafeRoute({
      ship,
      target: approach.target,
      entities: [...this.entities.values()],
      excludedId: asteroid.id,
      avoidShips: true,
      asteroidMargin: 20,
      checkDetours: true,
      lookahead: 500,
    });

    const distance = Vec.distance(ship.position, aim);

    this.miningBestAnchorDistance = Math.min(
      this.miningBestAnchorDistance,
      Vec.distance(ship.position, this.miningAnchor),
    );
    this.miningBestTargetDistance.set(
      asteroid.id,
      Math.min(
        this.miningBestTargetDistance.get(asteroid.id) ?? Infinity,
        distance,
      ),
    );

    this.miningApproachSamples.push({
      at,
      serverTick: this.tick,
      position: Vec.clone(ship.position),
      velocity: Vec.clone(ship.velocity || Vec.create()),
      rotation: ship.rotation,
      spin: ship.spin,
      input: this.lastInput,
      loadoutIntact: this.loadoutIntact,
      targetId: asteroid.id,
      targetPosition: asteroid.position,
      aim,
      centerTarget: approach.target,
      drillTip: this.drillTip,
      directTargetDistance: distance,
      bestTargetDistance: this.miningBestTargetDistance.get(asteroid.id),
      anchorDistance: Vec.distance(ship.position, this.miningAnchor),
      bestAnchorDistance: this.miningBestAnchorDistance,
      route,
      otherHopObstacles: route.obstacle
        ? [...this.entities.values()]
            .filter(
              (entity) =>
                entity.id !== asteroid.id &&
                entity.id !== route.obstacle.id &&
                entity.id !== ship.id &&
                ['station', 'asteroid', 'ship'].includes(entity.kind),
            )
            .map((entity) => ({
              id: entity.id,
              kind: entity.kind,
              gap:
                Vec.distance(route.target, entity.position) -
                obstacleRadius(entity) -
                ship.radius -
                (entity.kind === 'asteroid' ? 20 : 80),
            }))
            .filter((obstacle) => obstacle.gap < 0)
        : [],
      strictApproachReady: miningDrillSafe({
        ship,
        asteroid,
        entities: [...this.entities.values()],
      }),
    });

    if (this.miningApproachSamples.length > 72) {
      this.miningApproachSamples.shift();
    }
  }

  enableMining() {
    this.miningEnabled = true;
  }

  get loadoutIntact() {
    return (
      !!this.ship &&
      this.requiredModules.every((required) =>
        this.ship.modules?.some(
          (module) =>
            module.type === required.type &&
            module.mount === required.mount &&
            (required.id === undefined || module.id === required.id),
        ),
      )
    );
  }

  get ammo() {
    return (this.ship?.cargoContents || []).reduce(
      (total, entity) => total + ('rounds' in entity ? entity.rounds || 0 : 0),
      0,
    );
  }

  send(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    const encoded = this.options.runtime.encodeClientMessage(message);

    const receipt =
      message.type === 'snapshotAck' && this.measuring
        ? ++this.nextReceiptWrite
        : undefined;

    if (receipt !== undefined) this.pendingReceiptWrites.add(receipt);

    this.socket.send(encoded, (error) => {
      if (receipt !== undefined && this.pendingReceiptWrites.delete(receipt)) {
        if (error) {
          this.receiptFailures++;
        } else {
          this.receiptWritesCompleted++;
        }
      }

      if (error) this.errors.push(error.message);
    });

    if (this.measuring) {
      this.maximumBufferedBytes = Math.max(
        this.maximumBufferedBytes,
        this.socket.bufferedAmount,
      );
    }

    if (this.measuring) this.sentBytes += encoded.byteLength;

    if (message.type === 'snapshotAck' || message.type === 'input') {
      this.traffic.push({
        at: performance.now(),
        type: message.type,
        sequence: message.sequence,
      });
    }

    return true;
  }

  input(input: PlayerInput) {
    if (this.options.runtime.sameInput(input, this.lastInput)) return;
    const elapsedTicks = Math.max(0, (performance.now() - this.tickAt) * 0.03);
    const progress = this.tick + elapsedTicks;

    // Match a running game clock: timestamps advance between snapshots and
    // retain sub-tick input edges. The server's normal clock mapping applies.
    if (
      this.send({
        type: 'input',
        input,
        sequence: ++this.sequence,
        tick: Math.floor(progress),
        offset: (progress % 1) / 30,
      })
    ) {
      const at = performance.now();

      if (input.fire && !this.lastInput.fire) this.fireHeldSince = at;

      if (!input.fire && this.lastInput.fire) {
        this.fireHeldMs += at - this.fireHeldSince;
      }

      this.lastInput = { ...input };
    }
  }

  activity() {
    if (performance.now() - this.lastActivity > 15000) {
      this.send({ type: 'activity' });
      this.lastActivity = performance.now();
    }
  }

  assertHealthy({ allowConnecting = false } = {}) {
    const label = `Protocol client ${this.options.index}`;

    assert(
      !this.errors.length && !this.closedUnexpectedly,
      `${label}: ${this.errors.join('; ') || 'Unexpected WebSocket close'}`,
    );
    assert(
      this.socket.readyState === WebSocket.OPEN ||
        (allowConnecting && this.socket.readyState === WebSocket.CONNECTING),
      `${label}: WebSocket is not open (state ${this.socket.readyState})`,
    );
  }

  async until(
    condition: () => boolean,
    description: string,
    timeoutMs = this.options.preparationTimeoutMs ?? 600000,
  ) {
    const end = performance.now() + timeoutMs;

    for (;;) {
      this.assertHealthy({ allowConnecting: !this.welcomed });

      if (condition()) return;

      assert(
        performance.now() < end,
        `${description}: ${JSON.stringify(this.diagnostics())}`,
      );
      await wait(25);
    }
  }

  async ready() {
    await this.until(
      () => this.welcomed && !!this.ship,
      'Waiting for a live ship',
    );
  }

  diagnostics() {
    const asteroid = this.miningAnchor
      ? this.entities.get(this.miningAsteroidId)
      : undefined;

    const ownedRocks = this.miningAnchor
      ? [...this.entities.values()].filter(
          (entity) =>
            entity.kind === 'asteroid' &&
            miningAreaContains({
              position: entity.position,
              anchor: this.miningAnchor,
            }),
        )
      : [];

    const approach =
      asteroid && this.ship
        ? miningApproach({ ship: this.ship, asteroid, drillTip: this.drillTip })
        : undefined;

    const route =
      approach &&
      obstacleSafeRoute({
        ship: this.ship,
        target: approach.target,
        entities: [...this.entities.values()],
        excludedId: asteroid.id,
        avoidShips: true,
        asteroidMargin: 20,
        checkDetours: true,
        lookahead: 500,
      });

    const obstacle = route?.obstacle && this.entities.get(route.obstacle.id);

    const geometry = (entity: ReplicatedEntity) =>
      entity && {
        id: entity.id,
        position: entity.position,
        rotation: entity.rotation,
        radius: entity.radius,
        shapeOutline: entity.shapeOutline,
        segments: entity.segments?.map(({ health, shapeOutline }) => ({
          health,
          shapeOutline,
        })),
      };

    return {
      index: this.options.index,
      shipId: this.shipId,
      ship: this.ship,
      credits: this.credits,
      acknowledgedDock: this.acknowledgedDock,
      dockSequence: this.dockSequence,
      errors: this.errors,
      socketState: this.socket.readyState,
      lastSnapshotAgeMs: performance.now() - this.tickAt,
      loadoutIntact: this.loadoutIntact,
      firstRequiredModuleLoss: this.firstRequiredModuleLoss,
      spreadCorridor: this.spreadCorridor,
      maximumCorridorDeviation: this.maximumCorridorDeviation,
      maximumMiningAnchorDistance: this.maximumMiningAnchorDistance,
      weaponPreparation: this.flyoutStartedAt
        ? {
            flyout: this.weaponFlyout,
            flyoutStartedAt: this.flyoutStartedAt,
            currentDisplacement: this.ship
              ? Vec.distance(this.flyoutStartedPosition, this.ship.position)
              : null,
            settling: this.weaponSettling,
            clearAhead:
              !!this.ship &&
              weaponClearAhead({
                ship: this.ship,
                entities: [...this.entities.values()],
              }),
            blockedAhead: this.ship
              ? [...this.entities.values()]
                  .filter(
                    (entity) =>
                      !weaponClearAhead({
                        ship: this.ship,
                        entities: [entity],
                      }),
                  )
                  .map((entity) => ({
                    id: entity.id,
                    kind: entity.kind,
                    position: entity.position,
                    radius: entity.radius,
                  }))
              : [],
          }
        : undefined,
      mining: this.miningAnchor
        ? {
            anchor: this.miningAnchor,
            remainingOwnedAsteroids: ownedRocks.length,
            sizedNondecayingAsteroids: ownedRocks.filter(
              (entity) => !entity.decay && entity.radius >= 15,
            ).length,
            approachDescription:
              'Diagnostic unbounded face approach; active controls additionally enforce the working-disk bounds and inward recovery. The sized nondecaying count does not establish target eligibility.',
            aim: approach?.aim,
            centerTarget: approach?.target,
            drillTip: this.drillTip,
            targetGeometry: geometry(asteroid),
            obstacleGeometry: geometry(obstacle),
            approachSamples: this.miningApproachSamples,
            target: asteroid
              ? {
                  id: asteroid.id,
                  position: asteroid.position,
                  radius: asteroid.radius,
                  health: replicatedAsteroidHealth(asteroid),
                }
              : null,
            route: route || null,
            shipDistanceFromAnchor: this.ship
              ? Vec.distance(this.ship.position, this.miningAnchor)
              : null,
            drillSafe:
              !!this.ship &&
              miningDrillSafe({
                ship: this.ship,
                asteroid,
                entities: [...this.entities.values()],
                workingArea: this.miningAnchor,
              }),
          }
        : undefined,
    };
  }

  async dock() {
    this.assertHealthy();
    let entering = false;
    const deadline =
      performance.now() + (this.options.preparationTimeoutMs ?? 600000);

    while (!this.ship?.dockedTo) {
      this.assertHealthy();
      assert(
        this.ship,
        `Ship disappeared while docking: ${JSON.stringify(this.diagnostics())}`,
      );
      assert(
        performance.now() < deadline,
        `Physical docking timed out: ${JSON.stringify(this.diagnostics())}`,
      );
      const stations = [...this.entities.values()].filter(
        (entity) => entity.kind === 'station',
      );
      const station = stations.toSorted(
        (a, b) =>
          Vec.distanceSquared(this.ship.position, a.position) -
          Vec.distanceSquared(this.ship.position, b.position),
      )[0];

      assert(station, 'No station is visible near the fresh player spawn');
      const specification =
        this.options.runtime.catalog.stations[
          station.definitionId || 'corral-5'
        ];

      assert(
        specification,
        `Unknown station definition ${station.definitionId}`,
      );

      const controls = dockingControls({
        ship: this.ship,
        station,
        bayAngles: specification.dockingBays,
        entering,
      });

      entering = controls.entering;
      this.input(controls.input);
      this.activity();
      await wait(33);
    }

    this.input(neutralInput());
  }

  async craftAction(action: CraftAction, materialized: () => boolean) {
    this.assertHealthy();
    const sequence = ++this.dockSequence;

    assert(this.send({ type: 'dock', sequence, ...action }));
    await this.until(
      () => this.acknowledgedDock >= sequence && materialized(),
      `Station action ${action.action} did not materialize`,
    );
  }

  async equipWeapon() {
    await this.dock();
    const weapon = weaponForClient(this.options.index);

    if (weapon === 'none') return;
    const catalog = this.options.runtime.catalog;
    const definition = catalog.ships[this.ship.definitionId || 'mustang'];

    const mount = compatibleWeaponMount({
      mounts: definition.mounts,
      weapon,
      occupied: this.ship.modules.map((module) => module.mount),
    });

    assert(mount !== undefined, `No compatible ${weapon} mount`);

    if (this.ship.modules.some((module) => module.mount === mount)) {
      await this.craftAction(
        { action: 'remove', mount },
        () => !this.ship.modules.some((module) => module.mount === mount),
      );
    }

    const type = catalog.moduleIds.indexOf(weapon);

    await this.craftAction(
      {
        action: 'buy',
        mount,
        module: type,
        moduleId: -100000 - this.options.index,
      },
      () =>
        this.ship.modules.some(
          (module) => module.mount === mount && module.type === type,
        ),
    );

    if (weapon === 'autogun') {
      const before = this.ammo;

      assert.equal(
        before,
        0,
        'A fresh benchmark autogun ship must start with no ammunition',
      );

      await this.craftAction(
        { action: 'buyAmmo' },
        () => this.ammo === before + catalog.ammoRounds,
      );
      const items = this.ship.cargoContents.filter((item) => 'rounds' in item);

      assert.equal(items.length, 1, 'Buy exactly one ordinary ammunition item');
      assert(
        isOrdinaryAmmoItem(items[0], catalog),
        'The normal purchased ammunition item must contain exactly200 rounds',
      );
    }

    this.provisioned = {
      weapon,
      mount,
      type,
      credits: this.credits,
      ammoRounds: this.ammo,
      ammunitionItems: this.ship.cargoContents?.filter(
        (item) => 'rounds' in item,
      ),
      modules: this.ship.modules,
    };
  }

  async launch() {
    this.assertHealthy();

    if (!this.ship?.dockedTo) return;
    const station = this.entities.get(this.ship.dockedTo);

    assert(station, 'The docked station is missing from the decoded world');
    const deadline =
      performance.now() + (this.options.preparationTimeoutMs ?? 600000);
    const remaining = () => Math.max(1, deadline - performance.now());

    try {
      this.input({ ...neutralInput(), launch: true });
      await this.until(
        () => !this.ship?.dockedTo,
        'Launching the equipped ship',
        remaining(),
      );
      const heading = this.ship.rotation;

      this.input({ ...neutralInput(), thrust: 1 });
      await this.until(
        () => !this.ship?.launching,
        'Leaving the station launch corridor',
        remaining(),
      );

      while (
        Vec.distance(this.ship.position, station.position) <
        station.radius + 350
      ) {
        this.assertHealthy();
        assert(
          !this.ship.dockedTo,
          `The departing ship re-entered its docking trigger: ${JSON.stringify(this.diagnostics())}`,
        );
        assert(
          performance.now() < deadline,
          `The ship did not clear the station bay: ${JSON.stringify(this.diagnostics())}`,
        );
        this.input(headingControls({ ship: this.ship, angle: heading }));
        await wait(33);
      }

      this.beginFlyout();
      const flightAt = performance.now();

      while (
        performance.now() - flightAt < 10000 ||
        Vec.distance(this.flyoutStartedPosition, this.ship.position) < 20
      ) {
        this.assertHealthy();
        assert(
          this.loadoutIntact,
          `A fitted part was lost during the preparation flyout: ${JSON.stringify(this.diagnostics())}`,
        );
        assert(
          performance.now() < deadline,
          `The ordinary flyout did not complete: ${JSON.stringify(this.diagnostics())}`,
        );

        this.input(
          workloadControls({
            workload: 'weapon',
            index: this.options.index,
            players: this.options.players,
            elapsed: (performance.now() - flightAt) / 1000,
            ship: this.ship,
            entities: [...this.entities.values()],
            fanout: true,
          }),
        );

        await wait(33);
      }

      this.finishFlyout();
      const settlingAt = Date.now();
      const settlingDeadline = deadline;
      let extraNavigationFrames = 0;
      const blockers: Record<string, unknown>[] = [];
      let sampledAt = 0;

      while (true) {
        this.assertHealthy();

        const controls = weaponStagingControls({
          ship: this.ship,
          index: this.options.index,
          players: this.options.players,
          entities: [...this.entities.values()],
        });

        if (controls.ready) break;

        if (!controls.clear) extraNavigationFrames++;

        if (performance.now() - sampledAt >= 5000) {
          sampledAt = performance.now();

          blockers.push({
            at: Date.now(),
            position: Vec.clone(this.ship.position),
            velocity: this.ship.velocity,
            rotation: this.ship.rotation,
            clear: controls.clear,
            blockedAhead: [...this.entities.values()]
              .filter(
                (entity) =>
                  !weaponClearAhead({
                    ship: this.ship,
                    entities: [entity],
                    distance: 500,
                  }),
              )
              .map((entity) => ({
                id: entity.id,
                kind: entity.kind,
                position: entity.position,
                radius: entity.radius,
              })),
          });
        }

        this.weaponSettling = {
          startedAt: settlingAt,
          extraNavigationFrames,
          samples: blockers,
        };

        assert(
          this.loadoutIntact,
          `A fitted part was lost while settling: ${JSON.stringify(this.diagnostics())}`,
        );
        assert(
          performance.now() < settlingDeadline,
          `The outbound ship did not find clear staging space and settle: ${JSON.stringify(this.diagnostics())}`,
        );
        this.input(controls.input);
        await wait(33);
      }

      this.weaponSettling = {
        startedAt: settlingAt,
        endedAt: Date.now(),
        extraNavigationFrames,
        samples: blockers,
        position: Vec.clone(this.ship.position),
        velocity: Vec.clone(this.ship.velocity || Vec.create()),
        rotation: this.ship.rotation,
        spin: this.ship.spin,
      };
    } finally {
      this.input(neutralInput());
    }
  }

  workloadReady(
    workload: ProtocolWorkload,
    peers: ProtocolClient[],
    mining = true,
  ) {
    const ship = this.ship;

    if (!ship || ship.dockedTo || ship.launching || !this.loadoutIntact) {
      return false;
    }

    if (workload === 'convoy' || workload === 'spread') {
      return Vec.length(ship.velocity || Vec.create()) > 20;
    }

    if (workload === 'contact') {
      const partner = peers.find(
        (peer) => peer.options.index === (this.options.index ^ 1),
      )?.ship;

      return (
        !!partner &&
        Vec.distance(ship.position, partner.position) <=
          ship.radius + partner.radius + 30
      );
    }

    const moduleActive = (id: string) =>
      ship.modules
        ?.find(
          (module) =>
            module.type === this.options.runtime.catalog.moduleIds.indexOf(id),
        )
        ?.segments?.some(
          (segment) => segment.active > 0 && segment.activationProgress >= 1,
        );

    if (workload === 'module') {
      const asteroid = this.miningAsteroid;

      return (
        !!asteroid &&
        moduleActive('cargoHatch') &&
        moduleActive('searchLight') &&
        (mining
          ? moduleActive('hornDrill') &&
            miningDrillSafe({
              ship,
              asteroid,
              entities: [...this.entities.values()],
              workingArea: this.miningAnchor,
            })
          : miningDrillSafe({
              ship,
              asteroid,
              entities: [...this.entities.values()],
            }))
      );
    }

    const weapon = weaponForClient(this.options.index);
    const module = ship.modules?.find(
      (module) =>
        module.type === this.options.runtime.catalog.moduleIds.indexOf(weapon),
    );

    if (
      !(this.weaponFlyout?.displacement >= 20) ||
      !weaponStagingControls({
        ship,
        index: this.options.index,
        players: this.options.players,
        entities: [...this.entities.values()],
      }).ready
    ) {
      return false;
    }

    return weapon === 'none'
      ? true
      : moduleActive(weapon) &&
          !(module?.chargeCooldown > 0) &&
          (weapon !== 'autogun' || this.ammo > 0);
  }

  /*
   * Pilots may brake or bounce, and miners may turn between fragments. Their
   * measured activity gates establish actual work over the full window; this
   * boundary still requires intact, active ships. Weapons additionally need
   * a settled clear firing lane before spending ammunition.
   */
  measurementReady(
    workload: ProtocolWorkload,
    peers: ProtocolClient[],
    mining = true,
  ) {
    const ship = this.ship;

    if (!ship || ship.dockedTo || ship.launching || !this.loadoutIntact) {
      return false;
    }

    if (workload === 'contact') {
      return peers.some(
        (peer) =>
          peer.options.index === (this.options.index ^ 1) && !!peer.ship,
      );
    }

    return workload !== 'weapon' || this.workloadReady(workload, peers, mining);
  }

  spreadAligned() {
    const ship = this.ship;
    const corridor = this.spreadCorridor;

    return (
      !!corridor &&
      this.measurementReady('spread', []) &&
      Math.abs(wrappedAngle(corridor.heading - ship.rotation)) < 0.08 &&
      Math.abs(ship.spin) < 0.2
    );
  }

  spreadReady(seconds: number) {
    return (
      this.spreadAligned() &&
      Vec.length(this.ship.velocity || Vec.create()) >=
        Math.max(30, this.spreadCorridor.speed * 0.75) &&
      spreadCorridorClear({
        ship: this.ship,
        corridor: this.spreadCorridor,
        entities: [...this.entities.values()],
        stations: this.options.runtime.catalog.stations,
        remaining: spreadRemainingDistance({
          ship: this.ship,
          corridor: this.spreadCorridor,
          seconds,
        }),
      })
    );
  }

  private observeWeapons() {
    const ship = this.ship;

    if (!ship) {
      this.missingShipSnapshots++;
      return;
    }

    if (!this.loadoutIntact) this.missingModuleSnapshots++;

    if (this.lastInput.hornDrill) this.drillingInputSnapshots++;

    if (this.miningAnchor && !this.lastInput.hornDrill) {
      this.drillingSuppressedSnapshots++;
    }

    this.maximumDisplacement = Math.max(
      this.maximumDisplacement,
      Vec.distance(this.startPosition, ship.position),
    );

    if (Vec.length(ship.velocity || Vec.create()) >= 20) this.movingSnapshots++;

    if (this.spreadCorridor) {
      this.maximumCorridorDeviation = Math.max(
        this.maximumCorridorDeviation,
        spreadCorridorDeviation({
          position: ship.position,
          corridor: this.spreadCorridor,
        }),
      );
    }

    if (this.miningAnchor) {
      this.maximumMiningAnchorDistance = Math.max(
        this.maximumMiningAnchorDistance,
        Vec.distance(ship.position, this.miningAnchor),
      );
    }

    const activeModule = (id: string) =>
      ship.modules
        ?.find(
          (module) =>
            module.type === this.options.runtime.catalog.moduleIds.indexOf(id),
        )
        ?.segments?.some(
          (segment) => segment.active > 0 && segment.activationProgress > 0,
        );

    if (activeModule('hornDrill')) this.drillSnapshots++;

    if (activeModule('cargoHatch')) this.hatchSnapshots++;

    if (activeModule('searchLight')) this.lightSnapshots++;

    for (const entity of this.entities.values()) {
      if (entity.kind === 'asteroid') {
        if (this.miningTargetIds.has(entity.id)) {
          this.minimumAssignedAsteroidSurfaceGap = Math.min(
            this.minimumAssignedAsteroidSurfaceGap,
            Vec.distance(ship.position, entity.position) -
              ship.radius -
              entity.radius,
          );
        }

        this.minimumAsteroidSurfaceGap = Math.min(
          this.minimumAsteroidSurfaceGap,
          Vec.distance(ship.position, entity.position) -
            ship.radius -
            entity.radius,
        );
        const health = replicatedAsteroidHealth(entity);

        if (health !== undefined) {
          const previous = this.asteroidHealth.get(entity.id);

          if (previous !== undefined && health < previous) {
            this.asteroidDamageChanges++;

            if (this.miningTargetIds.has(entity.id)) {
              this.assignedAsteroidDamageChanges++;
            }
          }

          this.asteroidHealth.set(entity.id, health);
        }
      }
    }

    const type = this.options.runtime.catalog.moduleIds.indexOf(
      weaponForClient(this.options.index),
    );
    const module = ship.modules?.find((module) => module.type === type);

    if (
      module?.segments?.some(
        (segment) => segment.active > 0 && segment.activationProgress >= 1,
      )
    ) {
      this.activeSnapshots++;
    }

    if (ship.firing) this.firingSnapshots++;

    if (module?.fireCooldown > 0) this.cooldownSnapshots++;

    const cooldown = module?.fireCooldown ?? 0;

    if (
      this.previousFireCooldown !== undefined &&
      cooldown > this.previousFireCooldown + 1e-6
    ) {
      this.fireCooldownStarts++;
    }

    this.previousFireCooldown = cooldown;

    if (module?.chargeCooldown > 0) this.chargeSnapshots++;

    if (ship.storedPower !== undefined) {
      this.minPower = Math.min(this.minPower, ship.storedPower);
      this.maxPower = Math.max(this.maxPower, ship.storedPower);
    }

    this.minimumAmmo = Math.min(this.minimumAmmo, this.ammo);

    for (const entity of this.entities.values()) {
      if (entity.kind !== 'projectile') continue;
      const key = entity.definitionId || 'unspecified';

      if (!this.projectileIds.has(key)) this.projectileIds.set(key, new Set());
      this.projectileIds.get(key).add(entity.id);
    }
  }

  start() {
    this.assertHealthy();
    const previous = this.traffic.findLast(
      (message) => message.type === 'snapshot' || message.type === 'load',
    );

    this.traffic.length = 0;

    if (previous) this.traffic.push(previous);
    this.started = true;
    this.measuring = true;
    this.ammoStart = this.ammo;
    this.requestedReceipts = this.sentReceipts = this.receiptFailures = 0;
    this.tickGaps = [];
    this.decodeMs.length = 0;
    this.activeSnapshots =
      this.firingSnapshots =
      this.cooldownSnapshots =
      this.chargeSnapshots =
      this.deaths =
        0;
    this.missingShipSnapshots = 0;
    this.missingModuleSnapshots =
      this.drillingInputSnapshots =
      this.drillingSuppressedSnapshots =
        0;
    this.fireCooldownStarts = 0;
    this.previousFireCooldown = undefined;
    this.premeasurementFireHeldMs =
      this.fireHeldMs +
      (this.lastInput.fire ? performance.now() - this.fireHeldSince : 0);
    this.projectileIds.clear();
    this.minPower = Infinity;
    this.maxPower = -Infinity;
    this.minimumAmmo = Infinity;
    this.startPosition = Vec.clone(this.ship.position);
    this.maximumDisplacement = 0;
    this.movingSnapshots = 0;
    this.maximumCorridorDeviation = 0;
    this.maximumMiningAnchorDistance = 0;
    this.minimumPeerSurfaceGap = this.minimumAsteroidSurfaceGap = Infinity;
    this.minimumAssignedAsteroidSurfaceGap = Infinity;
    this.assignedAsteroidDamageChanges = 0;
    this.miningFractures = [];
    this.drillSnapshots =
      this.hatchSnapshots =
      this.lightSnapshots =
      this.asteroidDamageChanges =
        0;
    this.asteroidHealth.clear();
    this.snapshotBytes = this.controlBytes = this.sentBytes = 0;
    this.pendingReceiptWrites.clear();
    this.nextReceiptWrite = 0;
    this.receiptWritesCompleted = this.maximumBufferedBytes = 0;
  }

  observePeers(peers: ProtocolClient[]) {
    if (!this.measuring || !this.ship) return;
    const partner = peers.find(
      (peer) => peer.options.index === (this.options.index ^ 1),
    )?.ship;

    if (partner) {
      this.minimumPeerSurfaceGap = Math.min(
        this.minimumPeerSurfaceGap,
        Vec.distance(this.ship.position, partner.position) -
          this.ship.radius -
          partner.radius,
      );
    }
  }

  report(start: number, end: number) {
    const snapshots = this.traffic.filter(
      (message) => message.type === 'snapshot' || message.type === 'load',
    );

    const traffic = summarizeSnapshotTraffic({
      messages: this.traffic,
      start,
      end,
    });

    return {
      index: this.options.index,
      playerId: this.playerId,
      worldSeed: this.worldSeed,
      spawn: this.spawn,
      sectorName: this.sectorName,
      shipId: this.shipId,
      ...traffic,
      requestedReceipts: this.requestedReceipts,
      sentReceipts: this.sentReceipts,
      receiptFailures: this.receiptFailures,
      receiptWritesCompleted: this.receiptWritesCompleted,
      receiptWritesPending: this.pendingReceiptWrites.size,
      serverTickGap: distribution(this.tickGaps),
      serverTickSkips: snapshots.flatMap((message, index) => {
        const previous = snapshots[index - 1];

        return previous &&
          message.at >= start &&
          message.at < end &&
          message.serverTick > previous.serverTick + 1
          ? [
              {
                previousTick: previous.serverTick,
                serverTick: message.serverTick,
                at: performance.timeOrigin + message.at,
                gapMs: message.at - previous.at,
              },
            ]
          : [];
      }),
      decodeMs: distribution(this.decodeMs),
      decodeMeasurement:
        'Entire incoming binary callback: decode, delta application, requested receipt send, and observational bookkeeping; not decoder-only time.',
      errors: this.errors,
      closedUnexpectedly: this.closedUnexpectedly,
      deaths: this.deaths,
      missingShipSnapshots: this.missingShipSnapshots,
      shipAlive: !!this.ship && !!this.ship.modules?.length,
      loadoutIntact: this.loadoutIntact,
      missingModuleSnapshots: this.missingModuleSnapshots,
      requiredModules: this.requiredModules,
      firstRequiredModuleLoss: this.firstRequiredModuleLoss,
      finalState: {
        dockedTo: this.ship?.dockedTo ?? null,
        launching: this.ship?.launching ?? 0,
        position: this.ship?.position,
        velocity: this.ship?.velocity,
        thrust: this.ship?.thrust,
        turn: this.ship?.turn,
        rotation: this.ship?.rotation,
        fuel: this.ship?.fuel,
        modules: this.ship?.modules,
      },
      provisioned: this.provisioned,
      network: {
        maximumBufferedBytes: this.maximumBufferedBytes,
        bufferedBytesAtEnd: this.socket.bufferedAmount,
        snapshotBytes: this.snapshotBytes,
        controlBytes: this.controlBytes,
        sentBytes: this.sentBytes,
        receivedBytesPerSecond:
          ((this.snapshotBytes + this.controlBytes) * 1000) / (end - start),
        sentBytesPerSecond: (this.sentBytes * 1000) / (end - start),
        measurement:
          'WebSocket application payload bytes; receipt write callbacks establish local socket writes, not server receipt or isolated wire time.',
      },
      activity: {
        maximumDisplacement: this.maximumDisplacement,
        movingSnapshots: this.movingSnapshots,
        movingFraction: this.movingSnapshots / Math.max(1, traffic.snapshots),
        spreadCorridor: this.spreadCorridor,
        maximumCorridorDeviation: this.maximumCorridorDeviation,
        weaponFlyout: this.weaponFlyout,
        minimumPeerSurfaceGap: Number.isFinite(this.minimumPeerSurfaceGap)
          ? this.minimumPeerSurfaceGap
          : null,
        minimumAsteroidSurfaceGap: Number.isFinite(
          this.minimumAsteroidSurfaceGap,
        )
          ? this.minimumAsteroidSurfaceGap
          : null,
        drillSnapshots: this.drillSnapshots,
        drillFraction: this.drillSnapshots / Math.max(1, traffic.snapshots),
        hatchFraction: this.hatchSnapshots / Math.max(1, traffic.snapshots),
        lightFraction: this.lightSnapshots / Math.max(1, traffic.snapshots),
        drillingInputSnapshots: this.drillingInputSnapshots,
        drillingSuppressedSnapshots: this.drillingSuppressedSnapshots,
        miningAnchor: this.miningAnchor ?? null,
        maximumMiningAnchorDistance: this.miningAnchor
          ? this.maximumMiningAnchorDistance
          : null,
        miningTargetIds: [...this.miningTargetIds],
        hatchSnapshots: this.hatchSnapshots,
        lightSnapshots: this.lightSnapshots,
        asteroidDamageChanges: this.asteroidDamageChanges,
        assignedAsteroidDamageChanges: this.assignedAsteroidDamageChanges,
        ownMiningFractures: this.miningFractures,
        miningReplans: this.miningReplans,
        finalMiningState: this.miningAnchor ? this.diagnostics().mining : null,
        fractureMeasurement:
          'Normal effect4 sounds carry authoritative responsible-player and asteroid IDs. Events received during active own-cell drilling prove attributed asteroid fractures; collision can also cause this sound, so this is not a drill-only server collision counter.',
        minimumAssignedAsteroidSurfaceGap: Number.isFinite(
          this.minimumAssignedAsteroidSurfaceGap,
        )
          ? this.minimumAssignedAsteroidSurfaceGap
          : null,
        note: 'Surface gaps use bounding radii and establish proximity, not collision callbacks. Asteroid damage changes are visible-world observations and can also be caused by other players or NPCs.',
      },
      weapon: {
        kind: weaponForClient(this.options.index),
        activeSnapshots: this.activeSnapshots,
        firingSnapshots: this.firingSnapshots,
        activeFraction: this.activeSnapshots / Math.max(1, traffic.snapshots),
        firingFraction: this.firingSnapshots / Math.max(1, traffic.snapshots),
        fireCooldownStarts: this.fireCooldownStarts,
        premeasurementFireHeldMs: this.premeasurementFireHeldMs,
        cooldownSnapshots: this.cooldownSnapshots,
        chargeSnapshots: this.chargeSnapshots,
        ammoStart: this.ammoStart,
        ammoEnd: this.ammo,
        minimumAmmo: Number.isFinite(this.minimumAmmo)
          ? this.minimumAmmo
          : null,
        minPower: Number.isFinite(this.minPower) ? this.minPower : null,
        maxPower: Number.isFinite(this.maxPower) ? this.maxPower : null,
        observedProjectiles: Object.fromEntries(
          [...this.projectileIds].map(([id, ids]) => [id, ids.size]),
        ),
        projectileAttribution:
          'Visible projectile IDs by definition; the wire does not identify their firing player. Own cooldown/ammo/activation are checked separately.',
        cycleMeasurement:
          'A fire cooldown increase between two in-window authoritative observations establishes a new own-weapon firing cycle. A positive cooldown carried into the window is insufficient.',
      },
    };
  }

  async close() {
    this.closing = true;
    this.socket.close();
    await Promise.race([
      new Promise<void>((resolve) =>
        this.socket.once('close', () => resolve()),
      ),
      wait(2000),
    ]);

    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}

type WorkerCommand = {
  id: number;
  command: string;
  options?: {
    url: string;
    indices: number[];
    players: number;
    runtimePath: string;
    workload: ProtocolWorkload;
    seconds: number;
    warmup: number;
    preparationTimeoutMs: number;
  };
  index?: number;
  at?: number;
  timeoutMs?: number;
  indices?: number[];
  targets?: { index: number; asteroidId: number; anchor: Vec.Value }[];
  speed?: number;
  seconds?: number;
  corridors?: SpreadCorridor[];
};

async function workerMain() {
  let clients: ProtocolClient[] = [];
  let workload: ProtocolWorkload;
  let phase: 'idle' | 'hold' | 'fanout' | 'workload' = 'idle';
  const heldClients = new Set<ProtocolClient>();

  const waitingInput = {
    ...neutralInput(),
    cargoHatch: true,
    searchLight: true,
  };

  const heldInput = (client: ProtocolClient) =>
    workload !== 'spread'
      ? waitingInput
      : client.spreadCorridor
        ? headingControls({
            ship: client.ship,
            angle: client.spreadCorridor.heading,
            thrust: false,
            spinTolerance: 0.04,
          })
        : neutralInput();

  const approachConfirmed = new Set<ProtocolClient>();
  let phaseAt = 0;
  let firingEnabled = false;
  let miningEnabled = false;
  let measuredAt = 0;
  let measuredEnd = 0;
  let cpu: NodeJS.CpuUsage;
  let cpuAt = 0;
  let timerGaps: number[] = [];
  let previousTimer = performance.now();
  let maximumRss = process.memoryUsage().rss;
  const loop = monitorEventLoopDelay({ resolution: 1 });

  loop.enable();

  const timer = setInterval(() => {
    const now = performance.now();

    if (measuredAt && !measuredEnd) {
      timerGaps.push(now - previousTimer);
      maximumRss = Math.max(maximumRss, process.memoryUsage().rss);
    }

    previousTimer = now;

    for (const client of clients) {
      client.activity();
      client.observePeers(clients);

      if (phase === 'idle' || !client.ship || client.ship.dockedTo) continue;

      if (heldClients.has(client)) {
        // Let normal drag and contacts settle instead of repeatedly pushing
        // overlapping ships back toward their captured waiting positions.
        client.input(heldInput(client));
        continue;
      }

      if (
        workload === 'spread' &&
        phase === 'workload' &&
        Date.now() < phaseAt
      ) {
        client.input(heldInput(client));
        continue;
      }

      const entities = [...client.entities.values()];
      const partner = clients.find(
        (peer) => peer.options.index === (client.options.index ^ 1),
      )?.ship;

      client.input(
        workloadControls({
          workload,
          index: client.options.index,
          players: client.options.players,
          elapsed: Math.max(0, (performance.timeOrigin + now - phaseAt) / 1000),
          ship: client.ship,
          entities,
          partner,
          asteroidPositions: client.asteroidPositions,
          miningAnchor: client.miningAnchor,
          miningAsteroid: client.miningAsteroid,
          drillTip: client.drillTip,
          mining: miningEnabled,
          firing: firingEnabled,
          fanout: phase === 'fanout',
          spreadCorridor: client.spreadCorridor,
        }),
      );

      if (workload === 'module') client.recordMiningApproach();
    }
  }, 1000 / 30);

  const cleanup = async () => {
    clearInterval(timer);
    loop.disable();
    await Promise.all(clients.map((client) => client.close()));
  };

  process.once('disconnect', () => {
    void cleanup().finally(() => process.exit());
  });

  process.once('SIGTERM', () => {
    void cleanup().finally(() => process.exit());
  });

  process.on('message', async (message: WorkerCommand) => {
    try {
      let result: unknown;

      if (message.command === 'initialize') {
        const options = message.options;
        const runtime: ProtocolRuntime = await import(
          pathToFileURL(options.runtimePath).href
        );

        workload = options.workload;

        clients = options.indices.map(
          (index) =>
            new ProtocolClient({
              url: options.url,
              index,
              players: options.players,
              runtime,
              preparationTimeoutMs: options.preparationTimeoutMs,
            }),
        );

        await Promise.all(clients.map((client) => client.ready()));
        clients.forEach((client) => client.retainLoadout());
      } else if (message.command === 'equip') {
        const client = clients.find(
          (client) => client.options.index === message.index,
        );

        assert(client, `Missing client ${message.index}`);
        await client.equipWeapon();
        client.retainLoadout();
        result = client.diagnostics();
      } else if (message.command === 'launch') {
        await Promise.all(
          clients
            .filter(
              (client) =>
                message.index === undefined ||
                client.options.index === message.index,
            )
            .map((client) => client.launch()),
        );
      } else if (message.command === 'hold') {
        phase = 'hold';

        for (const client of clients) {
          heldClients.add(client);
          client.input(heldInput(client));
        }
      } else if (message.command === 'preparationProgress') {
        result = clients.map((client) => {
          const diagnostic = client.diagnostics();
          const mining = diagnostic.mining;

          return {
            index: client.options.index,
            phase,
            confirmed: approachConfirmed.has(client),
            intact: client.loadoutIntact,
            firstRequiredModuleLoss: diagnostic.firstRequiredModuleLoss,
            anchorDistance: mining?.shipDistanceFromAnchor,
            targetId: mining?.target?.id,
            sizedNondecayingRocks: mining?.sizedNondecayingAsteroids,
            blocking: mining?.route?.obstacle,
            blocked: mining?.route?.blocked,
            position: client.ship?.position,
          };
        });
      } else if (
        message.command === 'fanout' ||
        message.command === 'workload'
      ) {
        phase = message.command;
        phaseAt = message.at ?? Date.now();
        heldClients.clear();

        if (message.command === 'fanout' && message.indices) {
          for (const client of clients) {
            if (!message.indices.includes(client.options.index)) {
              heldClients.add(client);
            }
          }
        }
      } else if (message.command === 'diagnostics') {
        result = clients.map((client) => client.diagnostics());
      } else if (message.command === 'miningCandidates') {
        // Reserve a checked route from rest, rather than drifting off it while turning.
        result = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () =>
                Vec.length(client.ship.velocity || Vec.create()) < 5 &&
                Math.abs(client.ship.spin) < 0.04,
              'The survey ship did not settle before reserving its approach',
              message.timeoutMs,
            );

            return proposeMiningTargets({
              index: client.options.index,
              ship: client.ship,
              entities: [...client.entities.values()],
            });
          }),
        );
      } else if (message.command === 'spreadCandidates') {
        result = clients.map((client) =>
          proposeSpreadCorridors({
            ship: client.ship,
            index: client.options.index,
            players: client.options.players,
            entities: [...client.entities.values()],
            stations: client.options.runtime.catalog.stations,
            speed: message.speed,
          }),
        );
      } else if (message.command === 'spreadCorridors') {
        phase = 'hold';

        for (const client of clients) {
          client.spreadCorridor = message.corridors.find(
            (corridor) => corridor.index === client.options.index,
          );
          assert(
            client.spreadCorridor,
            `Missing reserved corridor for client ${client.options.index}`,
          );
          heldClients.add(client);
          client.input(heldInput(client));
        }
      } else if (message.command === 'enableCruise') {
        phase = 'workload';
        phaseAt = message.at ?? Date.now();
        heldClients.clear();

        result = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () => client.spreadReady(message.seconds),
              'The reserved cruise corridor did not confirm real heading and speed',
              2000,
            );

            return {
              index: client.options.index,
              confirmedAt: Date.now(),
              position: Vec.clone(client.ship.position),
              velocity: Vec.clone(client.ship.velocity || Vec.create()),
              rotation: client.ship.rotation,
              spin: client.ship.spin,
            };
          }),
        );
      } else if (message.command === 'alignSpread') {
        result = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () =>
                client.spreadAligned() &&
                Vec.length(client.ship.velocity || Vec.create()) < 5 &&
                spreadCorridorClear({
                  ship: client.ship,
                  corridor: client.spreadCorridor,
                  entities: [...client.entities.values()],
                  stations: client.options.runtime.catalog.stations,
                }),
              'The reserved corridor did not settle with neutral heading, rest, and observed clearance',
              message.timeoutMs,
            );

            return {
              index: client.options.index,
              confirmedAt: Date.now(),
              position: Vec.clone(client.ship.position),
              velocity: Vec.clone(client.ship.velocity || Vec.create()),
              rotation: client.ship.rotation,
              spin: client.ship.spin,
              corridor: client.spreadCorridor,
            };
          }),
        );
      } else if (message.command === 'checkSpreadCorridor') {
        result = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () => client.spreadReady(message.seconds),
              'A reserved cruise corridor lost its heading, motion, or observed clearance',
              1000,
            );

            return {
              index: client.options.index,
              checkedAt: Date.now(),
              position: Vec.clone(client.ship.position),
              remaining: spreadRemainingDistance({
                ship: client.ship,
                corridor: client.spreadCorridor,
                seconds: message.seconds,
              }),
              velocity: Vec.clone(client.ship.velocity || Vec.create()),
              rotation: client.ship.rotation,
              spin: client.ship.spin,
              corridor: client.spreadCorridor,
            };
          }),
        );
      } else if (message.command === 'miningTargets') {
        for (const client of clients) {
          const target = message.targets.find(
            (target) => target.index === client.options.index,
          );

          if (!target) continue;
          client.miningAnchor = target.anchor;
          client.miningAsteroidId = target.asteroidId;
          client.miningTargetIds.add(target.asteroidId);
        }
      } else if (message.command === 'start') {
        measuredAt = cpuAt = performance.now();
        cpu = process.cpuUsage();
        measuredEnd = 0;
        loop.reset();
        timerGaps = [];
        maximumRss = process.memoryUsage().rss;
        clients.forEach((client) => client.start());
      } else if (message.command === 'enableFiring') {
        firingEnabled = true;
        await Promise.all(
          clients
            .filter(
              (client) => weaponForClient(client.options.index) !== 'none',
            )
            .map((client) =>
              client.until(
                () =>
                  !!client.ship?.firing &&
                  client.workloadReady('weapon', clients),
                'Continuous firing was not confirmed',
                2000,
              ),
            ),
        );
        result = { confirmedAt: Date.now() };
      } else if (message.command === 'enableMining') {
        miningEnabled = true;
        clients.forEach((client) => client.enableMining());

        result = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () => client.workloadReady('module', clients, true),
              'The miner did not confirm normal powered startup inside its owned area',
              message.timeoutMs ?? client.options.preparationTimeoutMs,
            );

            return {
              index: client.options.index,
              confirmedAt: Date.now(),
              position: Vec.clone(client.ship.position),
              targetId: client.miningAsteroidId,
              loadoutIntact: client.loadoutIntact,
            };
          }),
        );
      } else if (message.command === 'checkReady') {
        clients.forEach((client) => client.assertHealthy());
        assert(
          clients.every((client) =>
            client.measurementReady(workload, clients, miningEnabled),
          ),
          `The ${workload} workload lost current readiness before measurement: ${JSON.stringify(clients.map((client) => client.diagnostics()))}`,
        );
      } else if (message.command === 'readyWorkload') {
        const began = performance.now();

        const confirmed = await Promise.all(
          clients.map(async (client) => {
            await client.until(
              () => {
                assert(
                  client.loadoutIntact,
                  `Required fitted parts were lost during preparation: ${JSON.stringify(client.diagnostics())}`,
                );
                return client.workloadReady(workload, clients, miningEnabled);
              },
              `Waiting for the client's strict physical ${workload} approach`,
              message.timeoutMs ?? client.options.preparationTimeoutMs,
            );

            if (workload === 'module' && !miningEnabled) {
              approachConfirmed.add(client);
              heldClients.add(client);
              client.input(waitingInput);
            }

            return {
              index: client.options.index,
              confirmedAt: Date.now(),
              shipId: client.shipId,
              position: Vec.clone(client.ship.position),
              velocity: Vec.clone(client.ship.velocity || Vec.create()),
              dockedTo: client.ship.dockedTo ?? null,
              miningAnchor: client.miningAnchor,
              miningAsteroidId: client.miningAsteroidId,
              requiredModules: client.ship.modules.map(
                ({ id, type, mount }) => ({
                  id,
                  type,
                  mount,
                }),
              ),
            };
          }),
        );

        result = {
          waitedMs: performance.now() - began,
          clients: confirmed,
        };
      } else if (message.command === 'stop') {
        measuredEnd = performance.now();
        const used = process.cpuUsage(cpu);

        const eventLoopDelayMs = {
          p95: loop.percentile(95) / 1e6,
          p99: loop.percentile(99) / 1e6,
          max: loop.max / 1e6,
        };

        phase = 'idle';

        clients.forEach((client) => {
          client.measuring = false;
          client.input(neutralInput());
        });

        result = {
          pid: process.pid,
          allowedCpus:
            (await readFile('/proc/self/status', 'utf8')).match(
              /^Cpus_allowed_list:\s*(.+)$/m,
            )?.[1] ?? null,
          elapsedMs: measuredEnd - cpuAt,
          cpuUserMs: used.user / 1000,
          cpuSystemMs: used.system / 1000,
          cpuPercentOfOneCore:
            (used.user + used.system) / 10 / (measuredEnd - cpuAt),
          rssBytes: maximumRss,
          eventLoopDelayMs,
          inputTimerGapMs: distribution(timerGaps),
        };
      } else if (message.command === 'report') {
        result = clients.map((client) =>
          client.report(measuredAt, measuredEnd),
        );
      } else if (message.command === 'close') {
        await cleanup();
      } else {
        throw new Error(`Unknown worker command ${message.command}`);
      }

      process.send?.({ id: message.id, result });

      if (message.command === 'close') process.disconnect();
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : JSON.stringify(error),
      });
    }
  });
}

if (process.argv[2] === '--protocol-worker') await workerMain();
