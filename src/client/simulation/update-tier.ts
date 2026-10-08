import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { type SimulationWorld } from './world';
import { type PlayerId } from '../protocol/entities';
import { type PlayerInput } from '../protocol/input';
import { type InputFrame } from '../protocol/input-frame';
import { type SimulationEvent } from '../protocol/events';
import { controlShip } from '../objects/control-ship';
import { Ship } from '../objects/ship';
import { Craft } from '../objects/craft';
import { simulationStep } from '../../specs/simulation';
import { updateTiers } from '../../specs/update-tier';
import { visibleRange } from '../../specs/replication';

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
    entities: GameObject[];
    entries: {
      entity: GameObject;
      tier: (typeof updateTiers)[keyof typeof updateTiers];
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
  entities,
  tick = world.tick,
  inputs,
  events = [],
  dt = simulationStep,
  inputOffset = 0,
}: {
  world: SimulationWorld;
  entities?: GameObject[];
  tick?: number;
  inputs?: Map<PlayerId, PlayerInput | InputFrame>;
  events?: SimulationEvent[];
  dt?: number;
  inputOffset?: number;
}) => {
  let schedule = schedules.get(world);

  if (!schedule) {
    schedule = { observers: [], parents: [], entities: [], entries: [] };
    schedules.set(world, schedule);
  }

  const { observers, parents, entries: scheduled } = schedule;
  const list = entities || schedule.entities;

  if (!entities) {
    list.length = 0;
    world.entities.forEach((entity) => list.push(entity));
  }

  observers.length = parents.length = 0;

  world.players.forEach((player) => {
    const entity = world.entities.get(player.shipId);

    if (entity) observers.push(entity);
  });

  for (let index = 0; index < list.length; index++) {
    const entity = list[index];

    // Determine the tier without allocating per-entity options or a callback.
    let tier: (typeof updateTiers)[keyof typeof updateTiers] =
      updateTiers.visible;

    if (observers.length) {
      tier = updateTiers.distant;

      for (
        let observerIndex = 0;
        observerIndex < observers.length;
        observerIndex++
      ) {
        if (
          Vec.distanceSquared(
            entity.position,
            observers[observerIndex].position,
          ) <=
          visibleRange * visibleRange
        ) {
          tier = updateTiers.visible;
          break;
        }
      }
    }

    if (
      tier === updateTiers.visible &&
      !entity.velocity.x &&
      !entity.velocity.y &&
      !(entity instanceof Craft)
    ) {
      tier = updateTiers.drift;
    }

    const step = (entity.pendingUpdateTime + simulationStep) / tier.substeps;
    const entry = scheduled[index];

    if (entry) {
      entry.entity = entity;
      entry.tier = tier;
      entry.step = step;
    } else scheduled.push({ entity, tier, step });
  }

  scheduled.length = list.length;

  world.entities.forEach((entity) => {
    if (entity.holds) parents.push(entity);
  });

  world.movementParents = parents;

  // Plain loops: a callback capturing the reassigned elapsed time would box
  // it, and allocate a context, for every entity.
  for (let substep = 0; substep < updateTiers.visible.substeps; substep++) {
    for (let index = 0; index < scheduled.length; index++) {
      const { entity, tier, step } = scheduled[index];

      if (entity.dead) continue;

      if (!substep) entity.pendingUpdateTime += dt;

      if ((tick + 1) % tier.updateEvery || substep >= tier.substeps) continue;

      if (entity.pendingUpdateTime <= 0) continue;
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
        for (const change of input.changes) {
          const offset = change.offset - inputOffset;

          if (offset < elapsed || offset >= end) continue;

          if (offset > elapsed) {
            entity.update(offset - elapsed);
            entity.resolveLasers(offset - elapsed, events);
          }

          controlShip(entity, change.input, events);
          elapsed = offset;
        }
      }

      entity.update(end - elapsed);

      if (entity instanceof Ship) entity.resolveLasers(end - elapsed, events);

      if (entity.dead) {
        entity.onDeath?.(events);
        const event = entity.deathEvent;

        if (event) events.push(event);
        world.entities.delete(entity.id);
      }
    }
  }

  world.movementParents = undefined;
};
