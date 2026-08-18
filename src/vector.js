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
