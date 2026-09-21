import { type GameObject } from '../game-object';
import { type SimulationWorld } from './world';

export const simulationStep = 1 / 60;
export const updateTiers = {
  close: { substeps: 2, updateEvery: 1, replicateEvery: 1 },
  visible: { substeps: 1, updateEvery: 1, replicateEvery: 2 },
  distant: { substeps: 1, updateEvery: 4, replicateEvery: 8 },
} as const;

/*
 * Include hull extents and relative travel in the small-collision tier.
 */
export const updateTier = ({
  entity,
  observers,
}: {
  entity: GameObject;
  observers: GameObject[];
}) => {
  if (
    observers.some(
      (observer) =>
        entity.position.distanceTo(observer.position) <=
        100 +
          entity.radius +
          observer.radius +
          (entity.velocity.length() + observer.velocity.length()) *
            simulationStep,
    )
  )
    return updateTiers.close;
  return observers.some(
    (observer) => entity.position.distanceTo(observer.position) <= 2000,
  )
    ? updateTiers.visible
    : updateTiers.distant;
};

/*
 * One movement schedule for normal simulation and snapshot catch-up.
 * Normal simulation adds contacts after each pass; catch-up only moves bodies.
 * Pending time is mechanics state, so tier changes and rollback preserve it.
 */
export const updateEntities = ({
  world,
  entities = [...world.entities.values()],
  tick = world.tick,
  afterUpdate,
}: {
  world: SimulationWorld;
  entities?: GameObject[];
  tick?: number;
  afterUpdate?: (pass: { entities: GameObject[]; substep: number }) => void;
}) => {
  const observers = [...world.players.values()]
    .map((player) => world.entities.get(player.shipId))
    .filter((entity) => entity !== undefined);
  const scheduled = entities.map((entity) => ({
    entity,
    tier: observers.length
      ? updateTier({ entity, observers })
      : updateTiers.close,
  }));
  for (let substep = 0; substep < updateTiers.close.substeps; substep++) {
    world.movementParents = [...world.entities.values()].filter(
      (entity) => entity.holds,
    );
    const active = scheduled
      .filter(({ entity, tier }) => {
        if (entity.dead) return false;
        if (!substep) entity.pendingUpdateTime += simulationStep;
        if ((tick + 1) % tier.updateEvery || substep >= tier.substeps)
          return false;
        const dt = entity.pendingUpdateTime / (tier.substeps - substep);
        entity.pendingUpdateTime -= dt;
        entity.update(dt);
        if (entity.dead) world.entities.delete(entity.id);
        return !entity.dead;
      })
      .map(({ entity }) => entity);
    world.movementParents = undefined;
    afterUpdate?.({ entities: active, substep });
  }
};
