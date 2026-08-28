import { rotatePoint } from './vector';

export const rotateAround = (parent, child, x, y, angle) => {
  const point = rotatePoint({ x, y }, angle);

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
export const localMovement = (child, movers, dt) => {
  let parent = child.localMovementParent;

  if (parent && !parent.holds(child)) {
    // Drifted clear of whatever had hold of it, so it is on its own again
    child.velocity.set(child.velocity.add(parent.momentum(child)));
    parent = 0;
  }

  parent ||= movers.find((mover) => mover !== child && mover.holds(child));
  child.localMovementParent = parent;
  parent && rotateAround(parent, child, child.x - parent.x, child.y - parent.y, parent.spin * dt);
};
