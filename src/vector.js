export const dir = (vec) => Math.atan2(vec.y, vec.x);

export const magnitude = (vec) => Math.sqrt(vec.x * vec.x + vec.y * vec.y);

export const normalize = (vec) => {
  const mag = magnitude(vec);
  return { x: vec.x / mag, y: vec.y / mag };
};

export const multiply = (vec, val) => ({
  x: vec * val,
  y: vec * val,
});

export const dotProduct = (vec1, vec2) => vec1.x * vec2.x + vec1.y * vec2.y;

// Below this a sprite is drifting slowly enough to just call it stopped
const minSpeed = 1;

/**
 * Cap a velocity at a top speed, and drag it back towards a stop when it is
 * under one. Heavier things carry their speed for longer.
 *
 * Changes the velocity it is given rather than handing one back.
 *
 * @param {Object} velocity
 * @param {Number} mass
 * @param {Number} maxSpeed
 * @param {Number} dt - Seconds since the last update.
 */
export const slow = (velocity, mass, maxSpeed, dt) => {
  const speed = magnitude(velocity);

  if (speed > maxSpeed) {
    velocity.x = velocity.x / speed * maxSpeed;
    velocity.y = velocity.y / speed * maxSpeed;
  } else if (speed < minSpeed) {
    velocity.x = 0;
    velocity.y = 0;
  } else {
    // Speed kept per frame, raised to the frames passed so that drag works
    // out the same however often the game updates. Capped short of 1, or a
    // heavy enough ship would drift on forever
    const drag = Math.min(0.995, 0.986 + mass / 2000) ** (dt * 60);

    velocity.x *= drag;
    velocity.y *= drag;
  }
};

// Fastest anything drifts on nothing but the speed it was given. A ship under
// power works its own top speed out of its thrusters instead of taking this
export const driftSpeed = 70;

// The furthest anything travels between one look at what it has run into and
// the next. Box2D caps a step the same way: past this, a thing can be one side
// of something thin before the step and the other side after, having never
// touched it at any point anything looked
const maxHop = 4;

/**
 * Carry a thing along by the speed it already has, dragging it back towards a
 * stop as it goes. Everything that moves does this and does it the same way,
 * whether it flies itself or was only ever shoved: the difference is in what
 * put speed into it beforehand, not in what happens to that speed afterwards.
 *
 * Anything quick enough to jump over something in one frame is moved in
 * several short hops instead, settling up after each. Space has no drag in it,
 * but flying without any is horrible.
 *
 * @param {Object} thing - Anything with a place, a velocity, a `mass` and a
 *   `maxSpeed`.
 * @param {Number} dt - Seconds since the last update.
 * @param {Function} [settle] - Run after every hop, to put right whatever that
 *   hop has ended up inside of.
 */
export const move = (thing, dt, settle) => {
  const hops = Math.max(1, Math.ceil((magnitude(thing.velocity) * dt) / maxHop));
  const step = dt / hops;

  for (let hop = 0; hop < hops; hop++) {
    slow(thing.velocity, thing.mass, thing.maxSpeed, step);

    thing.x += thing.dx * step;
    thing.y += thing.dy * step;

    settle?.();
  }
};
