import * as Vec from '../vector';
import { type GameObject } from '../game-object';
import { type SimulationWorld } from './world';
import { type PlayerId } from '../protocol/entities';
import { type PlayerInput } from '../protocol/input';
import { type InputFrame } from '../protocol/input-frame';
import { type SimulationEvent } from '../protocol/events';
import { controlShip } from '../craft/control-ship';
import { Ship } from '../craft/ship';
import { simulationStep, updateTiers, visibleRange } from '../settings';

/*
 * Nearby and on-screen objects share the same movement schedule.
 */
export const updateTier = ({
  entity,
  observers,
}: {
  entity: Pick<GameObject, 'position'>;
  observers: Pick<GameObject, 'position'>[];
}) => {
  return observers.some(
    (observer) =>
      Vec.distanceSquared(entity.position, observer.position) <=
      visibleRange * visibleRange,
  )
    ? updateTiers.visible
    : updateTiers.distant;
};

const schedules = new WeakMap<
  SimulationWorld,
  {
    observers: GameObject[];
    parents: GameObject[];
    entries: {
      entity: GameObject;
      tier: typeof updateTiers.visible | typeof updateTiers.distant;
      step: number;
    }[];
  }
>();

/*
 * One movement schedule for normal simulation and snapshot catch-up.
 * The normal world update sweeps the resulting motion through physics;
 * snapshot catch-up only moves bodies.
 * Pending time is mechanics state, so tier changes and rollback preserve it.
 */
export const updateEntities = ({
  world,
  entities = [...world.entities.values()],
  tick = world.tick,
  inputs,
  events = [],
  dt = simulationStep,
}: {
  world: SimulationWorld;
  entities?: GameObject[];
  tick?: number;
  inputs?: Map<PlayerId, PlayerInput | InputFrame>;
  events?: SimulationEvent[];
  dt?: number;
}) => {
  let schedule = schedules.get(world);

  if (!schedule) {
    schedule = { observers: [], parents: [], entries: [] };
    schedules.set(world, schedule);
  }
  const { observers, parents, entries: scheduled } = schedule;

  observers.length = parents.length = 0;
  world.players.forEach((player) => {
    const entity = world.entities.get(player.shipId);

    if (entity) observers.push(entity);
  });
  entities.forEach((entity, index) => {
    const tier = observers.length
      ? updateTier({ entity, observers })
      : updateTiers.visible;
    const step = (entity.pendingUpdateTime + simulationStep) / tier.substeps;
    const entry = scheduled[index];

    if (entry) {
      entry.entity = entity;
      entry.tier = tier;
      entry.step = step;
    } else scheduled.push({ entity, tier, step });
  });
  scheduled.length = entities.length;
  world.entities.forEach((entity) => {
    if (entity.holds) parents.push(entity);
  });
  world.movementParents = parents;

  for (let substep = 0; substep < updateTiers.visible.substeps; substep++) {
    scheduled.forEach(({ entity, tier, step }) => {
      if (entity.dead) return;

      if (!substep) entity.pendingUpdateTime += dt;

      if ((tick + 1) % tier.updateEvery || substep >= tier.substeps) return;

      if (entity.pendingUpdateTime <= 0) return;
      const duration = Math.min(entity.pendingUpdateTime, step);
      let elapsed = dt - entity.pendingUpdateTime;

      entity.pendingUpdateTime -= duration;
      const end = elapsed + duration;
      const input =
        entity instanceof Ship && entity.playerId !== undefined
          ? inputs?.get(entity.playerId)
          : undefined;

      // Split only where a control actually changed, preserving short taps
      // without raising the regular movement or collision frequency.
      if (input && 'changes' in input && entity instanceof Ship) {
        input.changes.forEach(({ input, offset }) => {
          if (offset < elapsed || offset >= end) return;

          if (offset > elapsed) entity.update(offset - elapsed);
          controlShip(entity, input, events);
          elapsed = offset;
        });
      }
      entity.update(end - elapsed);

      if (entity.dead) world.entities.delete(entity.id);
    });
  }
  world.movementParents = undefined;
};
