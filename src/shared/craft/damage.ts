import { type WorldObject, type Segment } from '../types';

export const damage = (
  object: WorldObject | Segment,
  amount: number,
  _point?: number[],
) => {
  const segment = (object.segment || object) as Segment;
  const target = segment.mount || segment;
  // Asteroids and items are ground down here too, and carry no module
  const { module } = segment;

  // A module that says so is untouchable in one of its two states: a closed
  // scoop lies flat in the hull, and a raised shield is all energy
  if (module && module.unhurtWhen === segment.active) return;

  if (target.health > 0) {
    target.health -= amount;

    if (target.health < 1 && target.item) target.remove();
  }

  segment.mounts?.forEach((mount) => {
    if (mount.health) {
      mount.health -=
        segment.health < 1
          ? mount.health
          : mount.module && mount.module.disablePhysics
            ? amount
            : 0;
    }
  });
};
