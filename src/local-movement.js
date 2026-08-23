import { rotatePoint } from './vector';

export const rotateAround = (parent, child, x, y, angle) => {
  const point = rotatePoint({ x, y }, angle);

  child.rotation += angle;
  child.position.set(parent.position.add(point));
};

/**
 * Let a child go from whatever was carrying it along, handing over the speed it
 * was being carried at. Being carried never touches a child's own velocity, so
 * without this all of that speed would vanish the moment it was let go of.
 *
 * @param {Object} child
 */
export const release = (child) => {
  if (!child.localMovementParent) return;

  child.velocity.set(child.velocity.add(child.localMovementParent.momentum(child)));
  child.localMovementParent = 0;
};

/**
 * Local movement is whatever a child is caught up in and carried along by, on
 * top of any moving it does under its own steam: a station swinging it slowly
 * around, or a road sweeping it away down a line.
 *
 * A road takes hold of anything that strays into it, and a station of anything
 * that drifts inside its reach. Nothing in the world overlaps anything else, so
 * a child is only ever caught up in one parent at a time.
 *
 * @param {Object} child
 * @param {Object[]} movers - Everything that could take a child up and carry it.
 * @param {Number} dt - Seconds since the last update.
 */
export const localMovement = (child, movers, dt) => {
  if (!child.mass) return;

  let parent = child.localMovementParent;

  if (parent && !parent.holds(child)) {
    // Drifted clear of whatever had hold of it, so it is on its own again
    release(child);
    parent = 0;
  }

  parent ||= movers.find((mover) => mover !== child && mover.holds(child));
  child.localMovementParent = parent;
  parent?.carry(child, dt);
};
