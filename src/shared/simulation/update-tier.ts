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
      Vec.distance(entity.position, observer.position) <= visibleRange,
  )
    ? updateTiers.visible
    : updateTiers.distant;
};

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
  const observers = [...world.players.values()]
    .map((player) => world.entities.get(player.shipId))
    .filter((entity) => entity !== undefined);
  const scheduled = entities.map((entity) => {
    const tier = observers.length
      ? updateTier({ entity, observers })
      : updateTiers.visible;
    // Partial samples use the same subdivision boundary as a complete tick,
    // including any time carried over from the distant tier.
    const step = (entity.pendingUpdateTime + simulationStep) / tier.substeps;

    return { entity, tier, step };
  });

  world.movementParents = [...world.entities.values()].filter(
    (entity) => entity.holds,
  );

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
