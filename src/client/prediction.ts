import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import { type PlayerId } from '../shared/protocol/entities';
import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../shared/protocol/input';
import { updateWorld } from '../shared/simulation/update-world';
import {
  updateEntities,
  updateTier,
  updateTiers,
} from '../shared/simulation/update-tier';
import { type SimulationEvent } from '../shared/protocol/events';
import { Asteroid } from '../shared/simulation/asteroid';
import { type SimulationWorld } from '../shared/simulation/world';
import { type WorldObject } from '../shared/simulation/world';
import { Ship } from '../shared/craft/ship';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
  type SimulationWorldState,
} from '../shared/simulation/world-state';

const historyLength = 120;
// Normal prediction is two ticks. A longer replay after a stall only adds
// more frame debt; recover from the checkpoint instead.
const maxReplayTicks = 4;

// @ifdef DEBUG
/** How hard the server has had to argue with the prediction lately. */
export const predictionStats = { corrections: 0, steps: 0, worst: 0 };

Object.assign(globalThis, { predictionStats });
// @endif

const matches = ({ ship, checkpoint }: { ship: Ship; checkpoint: Ship }) => {
  const hullHealth = checkpoint.hullHealth;
  return (
    ship.position.distanceTo(checkpoint.position) < 0.25 &&
    ship.velocity.distanceTo(checkpoint.velocity) < 0.25 &&
    Math.abs(ship.rotation - checkpoint.rotation) < 0.002 &&
    Math.abs(ship.spin - checkpoint.spin) < 0.002 &&
    (ship.launching || 0) === (checkpoint.launching || 0) &&
    ship.health === checkpoint.health &&
    ship.hullHealth.every((health, index) => health === hullHealth[index]) &&
    ship.dockedTo === checkpoint.dockedTo
  );
};

/** Copy one replicated entity over the client's own copy of it. */
const applyEntity = ({
  entity,
  server,
}: {
  entity: WorldObject;
  server: WorldObject;
}) => {
  entity.position.set(server.position);
  entity.velocity.set(server.velocity);
  entity.rotation = server.rotation;
  entity.spin = server.spin;
  entity.mass = server.mass;
  entity.radius = server.radius;
  entity.pendingUpdateTime = server.pendingUpdateTime;
  if (entity instanceof Asteroid && server instanceof Asteroid) {
    entity.contents = [...server.contents];
    entity.decay = server.decay;
    entity.health = server.health;
    entity.maxHealth = server.maxHealth;
    entity.resource = server.resource;
    entity.points = server.points;
    entity.radiusEven = server.radiusEven;
    entity.outline = server.outline?.map(([x, y]) => [x, y]);
    entity.sections = server.sections?.map((section) => ({
      ...section,
      contents: [...section.contents],
      outline: section.outline.map(([x, y]) => [x, y]),
    }));
  } else if (entity instanceof Craft && server instanceof Craft) {
    const cargo = new Map(
      server.cargoContents
        .filter((object) => !(object instanceof Module))
        .map((object) => [object, cloneEntity({ entity: object })]),
    );
    entity.cargoContents = server.cargoContents
      .filter((object) => !(object instanceof Module))
      .map((object) => cargo.get(object)!);
    entity.dockedTo = server.dockedTo;
    entity.health = server.health;
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
        : cargo.get(object)!,
    );
    entity.launching = server.launching;
    entity.paint = server.paint;
    entity.shades = server.shades;
    entity.segments.forEach((part) => {
      if (part.hull) part.shades = part.module.shades || server.shades;
    });
    entity.playerId = server.playerId;
    if (entity instanceof Ship && server instanceof Ship)
      entity.fly(server.thrust, server.turn);
  }
};

export class PredictionManager {
  private history = new Map<number, SimulationWorldState>();
  private lastSent?: PlayerInput;
  private localInputs = new Map<number, PlayerInput>();
  private localPlayerId?: PlayerId;
  private sequence = 0;
  private world: SimulationWorld;

  constructor({ world }: { world: SimulationWorld }) {
    this.world = world;
  }

  setLocalPlayer({ playerId }: { playerId: PlayerId }) {
    this.localPlayerId = playerId;
  }

  reset() {
    this.history.clear();
    this.localInputs.clear();
    this.lastSent = undefined;
  }

  recordInput({
    input,
    send,
  }: {
    input: PlayerInput;
    send: (message: {
      input: PlayerInput;
      sequence: number;
      tick: number;
    }) => void;
  }) {
    if (this.localPlayerId === undefined) return;
    const tick = this.world.tick;

    // A pilot holding a key says the same thing every tick, and both sides read
    // back the newest input at or before a tick, so only changes are recorded.
    if (!this.lastSent || !sameInput(this.lastSent, input)) {
      const savedInput = { ...input };

      this.lastSent = savedInput;
      this.localInputs.set(tick, savedInput);
      send({ input: savedInput, sequence: ++this.sequence, tick });
    }
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

  /**
   * Put the world back to the tick the server is reporting on, take its word
   * for that tick, and predict forward again from there.
   */
  reconcile({
    entities,
    entityIds = entities?.map((entity) => entity.id),
    entityTicks,
    tick,
  }: {
    entities?: WorldObject[];
    entityIds?: number[];
    entityTicks?: Map<number, number>;
    tick: number;
  }) {
    const targetTick = this.world.tick;
    if (Math.abs(targetTick - tick) > maxReplayTicks) {
      this.reset();
      this.world.tick = tick;
      this.applyServerState({ entities, entityIds, entityTicks });
      return;
    }
    const state = tick <= targetTick ? this.history.get(tick) : undefined;

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
    // A corrected neighbour can change our next contact even if our own
    // checkpoint matches. Replay that interaction through shared physics.
    const neighbourChanged =
      own &&
      entities?.some((entity) => {
        if (
          !(entity instanceof Ship) ||
          entity.id === own.id ||
          updateTier({ entity, observers: [own] }) !== updateTiers.close
        )
          return false;
        const before = state.entities.get(entity.id);
        return (
          !(before instanceof Ship) ||
          !matches({ ship: before, checkpoint: entity })
        );
      });

    if (
      !own ||
      (predicted instanceof Ship &&
        matches({ ship: predicted, checkpoint: own }) &&
        !neighbourChanged)
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

    restoreWorld({ world: this.world, state });
    this.applyServerState({ entities, entityIds, entityTicks });
    // @ifdef DEBUG
    predictionStats.corrections++;
    predictionStats.worst = Math.max(
      predictionStats.worst,
      predicted!.position.distanceTo(own.position),
    );
    // @endif
    this.replayTo({ targetTick });
    this.discardBefore({ tick });
  }

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
    entities?: WorldObject[];
    entityIds?: number[];
    entityTicks?: Map<number, number>;
    exclude?: number;
    catchUp?: number;
  }) {
    if (entities) {
      const replicated = new Set(entityIds);

      [...this.world.entities.keys()].forEach((id) => {
        if (!replicated.has(id)) this.world.entities.delete(id);
      });
      entities.forEach((server) => {
        const entity = this.world.entities.get(server.id);

        if (server.id === exclude) return;
        if (entity && entity.constructor === server.constructor)
          applyEntity({ entity, server });
        else {
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
    const fromTick = (entity: WorldObject) =>
      entityTicks?.get(entity.id) ?? this.world.tick - catchUp;
    const oldest = Math.min(this.world.tick, ...updated.map(fromTick));
    for (let tick = oldest; tick < this.world.tick; tick++)
      updateEntities({
        world: this.world,
        entities: updated.filter((entity) => fromTick(entity) <= tick),
        tick,
      });
  }

  replayTo({ targetTick }: { targetTick: number }) {
    while (this.world.tick < targetTick)
      this.simulate({ tick: this.world.tick });
    this.trim();
  }

  private simulate({ tick }: { tick: number }) {
    // @ifdef DEBUG
    predictionStats.steps++;
    // @endif
    // Recorded before the step, so a replay overwrites what the corrected run
    // left behind rather than measuring the next correction against it.
    this.history.set(tick, captureWorld({ world: this.world }));

    const inputs = new Map<PlayerId, PlayerInput>();
    const input = this.inputAt({ inputs: this.localInputs, tick });

    inputs.set(this.localPlayerId!, input || emptyPlayerInput());
    return updateWorld(this.world, inputs);
  }

  private inputAt({
    inputs,
    tick,
  }: {
    inputs?: Map<number, PlayerInput>;
    tick: number;
  }) {
    if (!inputs) return;
    let value: PlayerInput | undefined;
    let valueTick = -Infinity;

    [...inputs].forEach(([inputTick, candidate]) => {
      if (inputTick <= tick && inputTick > valueTick) {
        value = candidate;
        valueTick = inputTick;
      }
    });
    return value;
  }

  private discardBefore({ tick }: { tick: number }) {
    [...this.history.keys()].forEach((historyTick) => {
      if (historyTick < tick) {
        this.history.delete(historyTick);
      }
    });
  }

  private trim() {
    const oldest = this.world.tick - historyLength;

    this.discardBefore({ tick: oldest });
    // The newest input at or before a tick still speaks for every tick after
    // it, so only ones another already stands in front of are dropped.
    const newestStale = [...this.localInputs.keys()]
      .filter((tick) => tick <= oldest)
      .sort((a, b) => a - b)
      .at(-1);

    if (newestStale !== undefined)
      [...this.localInputs.keys()].forEach((tick) => {
        if (tick < newestStale) this.localInputs.delete(tick);
      });
  }
}
