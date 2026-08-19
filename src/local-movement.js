/**
 * Let a child go from whatever was carrying it along, handing over the speed it
 * was being carried at. Being carried never touches a child's own velocity, so
 * without this all of that speed would vanish the moment it was let go of.
 *
 * @param {Object} child
 */
export const release = (child) => {
  if (!child.localMovementParent) return;

  const [dx, dy] = child.localMovementParent.momentum(child);

  child.dx += dx;
  child.dy += dy;
  child.localMovementParent = null;
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
  const parent = movers.find((mover) => mover.holds(child));

  if (parent) {
    child.localMovementParent = parent;
    parent.carry(child, dt);
  } else if (child.localMovementParent) {
    // Drifted clear of whatever had hold of it, so it is on its own again
    release(child);
  }
};
