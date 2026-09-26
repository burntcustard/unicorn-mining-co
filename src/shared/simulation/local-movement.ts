import * as Vec from '../vector';
import { rotatePoint } from '../geometry';
import { type GameObject } from '../game-object';

/**
 * Local movement is whatever a child is caught up in and carried along by, on
 * top of any moving it does under its own steam: a craft turning beneath it.
 *
 * A craft takes hold of anything docked to it or that drifts inside its reach.
 * Nothing in the world overlaps anything else, so a child is only ever caught
 * up in one parent at a time.
 *
 * movers: Crafts that could take a child up and carry it.
 * dt: Seconds since the last update.
 */
export const localMovement = (
  child: GameObject,
  movers: Iterable<GameObject>,
  dt: number,
) => {
  let parent = child.localMovementParent;

  if (
    parent &&
    (parent.dead ||
      (child.world && child.world.entities.get(parent.id) !== parent) ||
      !parent.holds(child))
  ) {
    Vec.add(child.velocity, parent.momentum(child.position), child.velocity);
    parent = child.localMovementRate = 0;
  }

  if (!parent) {
    for (const mover of movers) {
      if (mover !== child && !mover.dead && mover.holds?.(child)) {
        parent = mover;
        break;
      }
    }
  }
  child.localMovementParent = parent;

  if (parent) {
    const angle =
      parent.spin *
      dt *
      (child.localMovementRate = Math.min(
        1,
        (child.localMovementRate || 0) + dt,
      ));
    const point = rotatePoint(
      Vec.subtract(child.position, parent.position),
      angle,
    );

    child.rotation += angle;
    Vec.add(parent.position, point, child.position);
  }
};
