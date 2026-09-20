import { rotatePoint } from './geometry';
import { type Vector } from './vector';

export const rotateAround = (
  parent: any,
  child: any,
  offset: Vector,
  angle: number,
) => {
  const point = rotatePoint(offset, angle);

  child.rotation += angle;
  child.position.set(parent.position.add(point));
};

/**
 * Local movement is whatever a child is caught up in and carried along by, on
 * top of any moving it does under its own steam: a craft turning beneath it.
 *
 * A craft takes hold of anything docked to it or that drifts inside its reach.
 * Nothing in the world overlaps anything else, so a child is only ever caught
 * up in one parent at a time.
 *
 * @param {Object} child
 * @param {Object[]} movers - Crafts that could take a child up and carry it.
 * @param {Number} dt - Seconds since the last update.
 */
export const localMovement = (child: any, movers: any[], dt: number) => {
  let parent = child.localMovementParent;

  if (parent && !parent.holds(child)) {
    child.velocity.set(child.velocity.add(parent.momentum(child.position)));
    parent = child.localMovementRate = 0;
  }

  parent ||= movers.find((mover) => mover !== child && mover.holds?.(child));
  child.localMovementParent = parent;

  if (parent) {
    rotateAround(
      parent,
      child,
      child.position.subtract(parent.position),
      parent.spin *
        dt *
        (child.localMovementRate = Math.min(
          1,
          (child.localMovementRate || 0) + dt,
        )),
    );
  }
};
