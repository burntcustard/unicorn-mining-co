import * as Vec from '../utilities/vector';
import { Craft } from '../objects/craft';
import { FramePrediction } from './frame-prediction';
import { Module } from '../objects/modules/module';
import { type PlayerId } from '../protocol/entities';
import { type InputFrame } from '../protocol/input-frame';
import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../protocol/input';
import { updateWorld } from '../simulation/update-world';
import { maxPredictionTicks } from '../../specs/prediction';
import { simulationStep } from '../../specs/simulation';
import { updateEntities } from '../simulation/update-tier';
import { type SimulationEvent } from '../protocol/events';
import { Asteroid } from '../objects/asteroid';
import { type SimulationWorld } from '../simulation/world';
import { type GameObject } from '../objects/game-object';
import { Ship } from '../objects/ship';
import { type EntityState } from '../simulation/entity-state';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
  type SimulationWorldState,
} from '../simulation/world-state';

// @ifdef DEBUG
/**
 * How hard the server has had to argue with the prediction lately.
 */
export const predictionStats = { corrections: 0, steps: 0, worst: 0 };

Object.assign(globalThis, { predictionStats });
// @endif

const matches = ({
  ship,
  checkpoint,
}: {
  ship: EntityState;
  checkpoint: Ship;
}) => {
  const hullHealth = checkpoint.hullHealth;
  const modules = checkpoint.moduleStates;
  const reportedModules = ship.moduleStates;
  const cargoIds = ship.cargoIds;

  return (
    Vec.distance(ship.position, checkpoint.position) < 0.25 &&
    Vec.distance(ship.velocity, checkpoint.velocity) < 0.25 &&
    Math.abs(ship.rotation - checkpoint.rotation) < 0.002 &&
    Math.abs(ship.spin - checkpoint.spin) < 0.002 &&
    (ship.launching || 0) === (checkpoint.launching || 0) &&
    ship.health === checkpoint.health &&
    checkpoint.cargoContents.length === cargoIds?.length &&
    checkpoint.cargoContents.every(
      (object, index) =>
        object.id === cargoIds[index] &&
        object.rounds === ship.cargoRounds[index],
    ) &&
    ship.hullHealth.every((health, index) => health === hullHealth[index]) &&
    modules?.length === reportedModules.length &&
    reportedModules.every((module, index) => {
      const predicted = modules[index];

      return (
        predicted.id === module.id &&
        predicted.type === module.type &&
        predicted.mount === module.mount &&
        predicted.health === module.health &&
        Math.abs((predicted.fireCooldown || 0) - (module.fireCooldown || 0)) <
          1e-8 &&
        predicted.segments.length === module.segments.length &&
        module.segments.every(
          (segment, segmentIndex) =>
            segment.active === predicted.segments[segmentIndex].active &&
            Math.abs(
              segment.activationProgress -
                predicted.segments[segmentIndex].activationProgress,
            ) < 1e-8,
        )
      );
    }) &&
    ship.dockedTo === checkpoint.dockedTo
  );
};

/**
 * Copy one replicated entity over the client's own copy of it.
 */
const applyEntity = ({
  entity,
  server,
}: {
  entity: GameObject;
  server: GameObject;
}) => {
  Vec.set(entity.position, server.position);
  Vec.set(entity.velocity, server.velocity);
  entity.rotation = server.rotation;
  entity.spin = server.spin;
  entity.mass = server.mass;
  entity.friction = server.friction;
  entity.radius = server.radius;
  entity.health = server.health;
  entity.dead = server.dead;
  entity.definitionId = server.definitionId;
  entity.playerId = server.playerId;
  entity.pendingUpdateTime = server.pendingUpdateTime;
  entity.rounds = server.rounds;

  if (entity instanceof Asteroid && server instanceof Asteroid) {
    entity.contents = [...server.contents];
    entity.decay = server.decay;
    entity.maxHealth = server.maxHealth;
    entity.resource = server.resource;
    entity.pointCount = server.pointCount;
    entity.radiusEven = server.radiusEven;
    entity.shapeOutline = server.shapeOutline?.map(([x, y]) => [x, y]);

    entity.segments = server.segments?.map((asteroidSegment) => ({
      ...asteroidSegment,
      contents: [...asteroidSegment.contents],
      shapeOutline: asteroidSegment.shapeOutline.map(([x, y]) => [x, y]),
    }));
  } else if (entity instanceof Craft && server instanceof Craft) {
    const cargoCopies = new Map(
      server.cargoContents
        .filter((object) => !(object instanceof Module))
        .map((object) => [object, cloneEntity({ entity: object })]),
    );

    entity.cargoContents = server.cargoContents
      .filter((object) => !(object instanceof Module))
      .map((object) => cargoCopies.get(object)!);
    entity.dockedTo = server.dockedTo;
    entity.decay = server.decay;

    if (server.decay) {
      const copied = cloneEntity({ entity: server }) as Craft;

      entity.hullSegments = copied.hullSegments;
      entity.segments = copied.segments;
      entity.cockpit = undefined;
    } else entity.hullHealth = [...server.hullHealth];

    entity.moduleStates = server.moduleStates;
    const modules = entity.modules;

    entity.cargoContents = server.cargoContents.map((object) =>
      object instanceof Module
        ? modules[server.modules.indexOf(object)]
        : cargoCopies.get(object)!,
    );
    entity.launching = server.launching;
    entity.paint = server.paint;
    entity.shades = server.shades;

    entity.segments.forEach((segment) => {
      if (segment.hull) segment.shades = segment.module.shades || server.shades;
    });

    if (entity instanceof Ship && server instanceof Ship) {
      entity.fly(server.thrust, server.turn);
    }
  }
};

export class PredictionManager {
  private frame = new FramePrediction();
  private history = new Map<number, SimulationWorldState>();
  private lastSent?: PlayerInput;
  private localInputs = new Map<number, InputFrame['changes']>();
  private localPlayerId?: PlayerId;
  private sequence = 0;
  private serverNextEntityId = 0;
  private world: SimulationWorld;

  /**
   * Membership is complete, but entity state is only included when due.
   * Remove missing IDs without removing or advancing unchanged tier members.
   */
  private applyServerState({
    entities,
    entityIds,
    entityTicks,
    exclude,
    catchUp = 0,
  }: {
    entities?: GameObject[];
    entityIds?: number[];
    entityTicks?: Map<number, number>;
    exclude?: number;
    catchUp?: number;
  }) {
    if (entityIds) {
      const replicated = new Set(entityIds);

      [...this.world.entities.keys()].forEach((id) => {
        if (!replicated.has(id)) this.world.entities.delete(id);
      });
    }

    if (entities) {
      entities.forEach((server) => {
        const entity = this.world.entities.get(server.id);

        if (server.id === exclude) return;

        if (entity && entity.constructor === server.constructor) {
          applyEntity({ entity, server });
        } else {
          const restored = cloneEntity({ entity: server });

          restored.world = this.world;
          restored.random = this.world.random;
          this.world.entities.set(server.id, restored);
        }

        this.world.nextEntityId = Math.max(
          this.world.nextEntityId,
          server.id + 1,
        );
      });
    }

    const updated = (entities || [])
      .filter((entity) => entity.id !== exclude)
      .map((entity) => this.world.entities.get(entity.id))
      .filter((entity) => entity !== undefined);
    // A packet batch can contain older slow-tier state. Preserve each sample's
    // tick rather than pretending all merged entities came from the last packet.
    const fromTick = (entity: GameObject) =>
      entityTicks?.get(entity.id) ?? this.world.tick - catchUp;
    const oldest = Math.min(this.world.tick, ...updated.map(fromTick));

    for (let tick = oldest; tick < this.world.tick; tick++) {
      updateEntities({
        world: this.world,
        entities: updated.filter((entity) => fromTick(entity) <= tick),
        tick,
      });
    }
  }

  constructor({ world }: { world: SimulationWorld }) {
    this.world = world;
  }

  private discardBefore({ tick }: { tick: number }) {
    [...this.history.keys()].forEach((historyTick) => {
      if (historyTick < tick) {
        this.history.delete(historyTick);
      }
    });
  }

  private inputAt({ tick }: { tick: number }) {
    let value = emptyPlayerInput();
    let valueTick = -Infinity;

    this.localInputs.forEach((changes, inputTick) => {
      if (inputTick < tick && inputTick > valueTick) {
        value = changes.at(-1)!.input;
        valueTick = inputTick;
      }
    });

    return { input: value, changes: this.localInputs.get(tick) || [] };
  }

  predictFrame({ elapsed }: { elapsed: number }) {
    return this.localPlayerId === undefined
      ? this.world
      : this.frame.sample({
          world: this.world,
          playerId: this.localPlayerId,
          input: this.inputAt({ tick: this.world.tick }),
          elapsed,
        });
  }

  /**
   * Put the world back to the tick the server is reporting on, take its word
   * for that tick, and predict forward again from there.
   */
  reconcile({
    entities,
    entityIds = entities?.map((entity) => entity.id),
    entityTicks,
    nextEntityId,
    tick,
  }: {
    entities?: GameObject[];
    entityIds?: number[];
    entityTicks?: Map<number, number>;
    nextEntityId?: number;
    tick: number;
  }) {
    const targetTick = this.world.tick;

    if (nextEntityId !== undefined) {
      this.serverNextEntityId = Math.max(this.serverNextEntityId, nextEntityId);
    }

    this.world.nextEntityId = Math.max(
      this.world.nextEntityId,
      this.serverNextEntityId,
    );

    this.frame.reset();

    if (Math.abs(targetTick - tick) > maxPredictionTicks) {
      this.reset();
      this.world.tick = tick;
      this.applyServerState({ entities, entityIds, entityTicks });
      return;
    }

    const sampleTick = (entity: GameObject) =>
      entityTicks?.get(entity.id) ?? tick;
    const oldest = Math.min(tick, ...(entities || []).map(sampleTick));
    // A batched packet may end beyond the last checkpoint but still contain
    // older samples. Replay those from their retained checkpoint so hits and
    // impulses survive the correction.
    const state =
      (tick <= targetTick && this.history.get(tick)) ||
      this.history.get(oldest);

    if (!state) {
      if (tick > targetTick) {
        this.world.tick = tick;
        this.reset();
      }

      // An old snapshot must still reach our current tick. Keep newer history:
      // clearing it here can prevent every subsequent snapshot from matching.
      this.applyServerState({
        entities,
        entityIds,
        entityTicks,
        catchUp: Math.max(0, targetTick - tick),
      });

      return;
    }

    const own = entities?.find(
      (entity): entity is Ship =>
        entity instanceof Ship &&
        this.localPlayerId !== undefined &&
        entity.playerId === this.localPlayerId,
    );
    const predicted = own && state.entities.get(own.id);
    // Damage and entity membership cannot be carried forward by movement
    // alone. Replay hits after an older snapshot instead of restoring a rock
    // whose predicted fracture has already removed it.
    const replicated = new Set(entityIds);

    const interactionChanged =
      (oldest < tick &&
        entities?.some(
          (entity) =>
            entity instanceof Asteroid || entity.kind === 'projectile',
        )) ||
      entities?.some((server) => {
        const entity = this.world.entities.get(server.id);

        if (server instanceof Asteroid) {
          // Blasts and contacts can change motion without changing health.
          // Movement-only catch-up would discard those intervening impulses.
          if (
            !(entity instanceof Asteroid) ||
            entity.health !== server.health ||
            Vec.distance(entity.velocity, server.velocity) > 1e-8 ||
            Math.abs(entity.spin - server.spin) > 1e-8
          ) {
            return true;
          }

          const segments = entity.segments;
          const reported = server.segments;

          return (
            segments?.length !== reported?.length ||
            reported?.some(
              (segment, index) =>
                segment.health !== segments[index].health ||
                segment.maxHealth !== segments[index].maxHealth,
            )
          );
        }

        if (server.kind !== 'projectile') return false;
        const before = state.entities.get(server.id);

        return (
          !entity ||
          entity.kind !== server.kind ||
          entity.definitionId !== server.definitionId ||
          entity.playerId !== server.playerId ||
          !before ||
          Math.abs(before.health - server.health) > 1e-8 ||
          Vec.distance(before.position, server.position) > 1e-8 ||
          Vec.distance(before.velocity, server.velocity) > 1e-8
        );
      }) ||
      (entityIds &&
        [...this.world.entities.values()].some(
          (entity) =>
            (entity instanceof Asteroid || entity.kind === 'projectile') &&
            !replicated.has(entity.id),
        ));

    // A corrected neighbour can change our next contact even if our own
    // checkpoint matches. Replay that interaction through shared physics.
    const neighbourChanged =
      own &&
      entities?.some((entity) => {
        if (
          !(entity instanceof Ship) ||
          entity.id === own.id ||
          Vec.distance(entity.position, own.position) >
            100 +
              entity.radius +
              own.radius +
              (Vec.length(entity.velocity) + Vec.length(own.velocity)) *
                simulationStep
        ) {
          return false;
        }

        const before = state.entities.get(entity.id);

        return (
          !(before?.entity instanceof Ship) ||
          !matches({ ship: before, checkpoint: entity })
        );
      });

    if (
      !interactionChanged &&
      (!own ||
        (predicted?.entity instanceof Ship &&
          matches({ ship: predicted, checkpoint: own }) &&
          !neighbourChanged))
    ) {
      // The pilot's own prediction held. Everything else is only as old as the
      // message, so it is set right and carried forward on its own rather than
      // dragging the whole world back through a replay.
      this.applyServerState({
        entities,
        entityIds,
        entityTicks,
        exclude: own?.id,
        catchUp: targetTick - tick,
      });

      this.discardBefore({ tick });
      return;
    }

    const start = this.history.get(oldest) || state;

    restoreWorld({ world: this.world, state: start });

    // Merged packets can contain different sample ticks. Apply each correction
    // at its own boundary and replay hits between them, then adopt membership
    // from the newest packet. Movement-only catch-up would lose that damage.
    while (this.world.tick < tick) {
      this.applyServerState({
        entities: entities?.filter(
          (entity) => sampleTick(entity) === this.world.tick,
        ),
      });

      this.simulate({ tick: this.world.tick });
    }

    // Preserve reservations at the newest packet's boundary, after replaying
    // earlier allocations. Discarded speculative IDs can be reused on replay.
    this.world.nextEntityId = Math.max(
      this.world.nextEntityId,
      this.serverNextEntityId,
    );

    this.applyServerState({
      entities: entities?.filter(
        (entity) =>
          sampleTick(entity) < start.tick || sampleTick(entity) >= tick,
      ),
      entityIds,
      entityTicks,
    });

    // @ifdef DEBUG
    predictionStats.corrections++;

    if (own && predicted) {
      predictionStats.worst = Math.max(
        predictionStats.worst,
        Vec.distance(predicted.position, own.position),
      );
    }

    // @endif
    this.replayTo({ targetTick });
    this.discardBefore({ tick });
  }

  recordInput({
    input,
    send,
    offset = 0,
  }: {
    input: PlayerInput;
    offset?: number;
    send: (message: {
      input: PlayerInput;
      sequence: number;
      tick: number;
      offset: number;
    }) => void;
  }) {
    if (this.localPlayerId === undefined) return;
    const tick = this.world.tick;

    // Preserve every edge, including multiple changes within the same tick.
    // Held controls need no repeated messages.
    if (!this.lastSent || !sameInput(this.lastSent, input)) {
      const savedInput = { ...input };

      this.lastSent = savedInput;
      const changes = this.localInputs.get(tick) || [];

      offset = Math.max(
        changes.at(-1)?.offset || 0,
        Math.min(simulationStep - 1e-9, Math.max(0, offset)),
      );
      changes.push({ input: savedInput, offset });
      this.localInputs.set(tick, changes);
      send({ input: savedInput, sequence: ++this.sequence, tick, offset });
    }
  }

  replayTo({ targetTick }: { targetTick: number }) {
    while (this.world.tick < targetTick) {
      this.simulate({ tick: this.world.tick });
    }

    this.trim();
  }

  reset() {
    this.frame.reset();
    this.serverNextEntityId = 0;
    this.history.clear();
    this.localInputs.clear();
    this.lastSent = undefined;
  }

  setLocalPlayer({ playerId }: { playerId: PlayerId }) {
    this.localPlayerId = playerId;
  }

  private simulate({ tick }: { tick: number }) {
    // @ifdef DEBUG
    predictionStats.steps++;
    // @endif
    // Recorded before the step, so a replay overwrites what the corrected run
    // left behind rather than measuring the next correction against it.
    this.history.set(tick, captureWorld({ world: this.world }));

    const inputs = new Map<PlayerId, InputFrame>();

    inputs.set(this.localPlayerId!, this.inputAt({ tick }));
    return updateWorld({ world: this.world, inputs: inputs });
  }

  step(
    options: Parameters<PredictionManager['recordInput']>[0],
  ): SimulationEvent[] {
    if (this.localPlayerId === undefined) return [];
    this.recordInput(options);
    const events = this.simulate({ tick: this.world.tick });

    this.trim();
    return events;
  }

  private trim() {
    // Keep enough history to replay controls across a brief network outage.
    const oldest = this.world.tick - maxPredictionTicks;

    this.discardBefore({ tick: oldest });
    // The newest input at or before a tick still speaks for every tick after
    // it, so only ones another already stands in front of are dropped.
    const newestStale = [...this.localInputs.keys()]
      .filter((tick) => tick <= oldest)
      .sort((a, b) => a - b)
      .at(-1);

    if (newestStale !== undefined) {
      [...this.localInputs.keys()].forEach((tick) => {
        if (tick < newestStale) this.localInputs.delete(tick);
      });
    }
  }
}
