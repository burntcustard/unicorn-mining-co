/**
 * Let go of whatever is carrying a thing along, handing over the speed it was
 * being carried at. Being carried never touches a thing's own velocity, so
 * without this all of that speed would vanish the moment it was let go of.
 *
 * @param {Object} thing
 */
export const release = (thing) => {
  const mover = thing.localMovement;

  if (!mover) return;

  const [dx, dy] = mover.momentum(thing);

  thing.dx += dx;
  thing.dy += dy;
  thing.localMovement = null;
};

/**
 * Forced movement is whatever a ship is caught up in and carried along by, on
 * top of the flying it does under its own steam: a station swinging it slowly
 * around, or a road sweeping it away down a line.
 *
 * A road takes hold of anything that strays into it, while a station has to be
 * asked. Nothing in the world overlaps anything else, so a ship is only ever
 * caught up in one thing at a time.
 *
 * @param {Object} thing
 * @param {Object[]} movers - Everything that could be carrying something.
 * @param {Number} dt - Seconds since the last update.
 */
export const carry = (thing, movers, dt) => {
  const grabbed = movers.find((mover) => mover.grabs && mover.holds(thing));

  if (grabbed) thing.localMovement = grabbed;

  const mover = thing.localMovement;

  if (!mover) return;

  // Out of reach, so the thing is on its own again
  if (!mover.holds(thing)) {
    release(thing);
    return;
  }

  mover.carry(thing, dt);
};
