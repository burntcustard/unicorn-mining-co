import { type Segment } from '../types';
import { type GameObject } from './game-object';
import { type AsteroidSegment } from '../protocol/entities';

export const damage = (
  object: GameObject | Segment | AsteroidSegment,
  amount: number,
  _point?: number[],
) => {
  const segment = (('segment' in object && object.segment) ||
    object) as Segment;
  const target = segment.mount || segment;
  // Asteroids and items are ground down here too, and carry no module
  const { module } = segment;

  if (module && !segment.active && module.health === 0) return 0;
  // Shield bubbles use activated health; their generator bodies use normal health.
  const usesActivatedHealth =
    module?.healthActivated !== undefined &&
    segment.active &&
    (!module.rechargeDuration || segment.covers);
  const health = usesActivatedHealth ? target.healthActivated : target.health;
  const applied = health > 0 ? amount : 0;

  if (health > 0) {
    if (usesActivatedHealth) {
      target.healthActivated = Math.max(0, health - amount);

      if (module.health === 0) target.health = target.healthActivated;

      if (target.healthActivated === 0 && module.rechargeDuration) {
        segment.active = 0;
        segment.activationProgress = 0;
      }
    } else target.health = health - amount;

    if (target.health < 1 && target.item) target.remove();
  }

  segment.mounts?.forEach((mount) => {
    if (!mount.health) return;

    if (segment.health < 1) {
      mount.health -= mount.health;
    } else if (mount.module && mount.module.disablePhysics) {
      mount.health -= amount;
    }
  });

  return applied;
};
