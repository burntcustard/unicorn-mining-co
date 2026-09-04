/**
 * Based on Kontra vector.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/vector.js
 *
 * Keeps the vector factory and the set, add, subtract, scale, normalize, dot,
 * length and distance operations used by the game. Clamp and its coordinate
 * accessors, angle, and direction are removed. `rotatePoint` and `movePoint`
 * come from Kontra helpers.js, and the game's drag is added here so all
 * vector-related work has one home:
 * https://github.com/straker/kontra/blob/main/src/helpers.js
 */

class VectorClass {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(vector) {
    Object.assign(this, vector);
  }

  add(vector) {
    return Vector(this.x + vector.x, this.y + vector.y);
  }

  subtract(vector) {
    return Vector(this.x - vector.x, this.y - vector.y);
  }

  scale(value) {
    return Vector(this.x * value, this.y * value);
  }

  normalize(length = this.length() || 1) {
    return Vector(this.x / length, this.y / length);
  }

  dot(vector) {
    return this.x * vector.x + this.y * vector.y;
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  distanceTo(vector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
}

export const Vector = (x, y) => new VectorClass(x, y);

export const applyForce = (object, force, spin = 0) => {
  object.velocity.set(object.velocity.add(force.scale(1 / object.mass)));
  object.spin += spin / object.mass;
};

export const rotatePoint = ({ x, y }, angle) => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return Vector(x * cos - y * sin, x * sin + y * cos);
};

export const movePoint = ({ x, y }, angle, distance) =>
  Vector(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);

export const directionOf = (angle) => Vector(Math.cos(angle), Math.sin(angle));

// A point some way between two others, plain arrays rather than Vectors so it
// also works on a polygon's raw points. `at` 0 gives `from`, 1 gives `to`,
// 0.5 the midpoint between them, and anywhere else the same share of the way
export const pointBetween = (from, to, at = 0.5) => {
  return from.map((value, axis) => value + (to[axis] - value) * at);
};

/**
 * Rotate local points around zero, then optionally move them into world space.
 * Used wherever shapes need the same coordinates after their owner turns.
 */
export const rotatePoints = (points, angle, x = 0, y = 0) => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return points.map(([pointX, pointY]) => {
    return [x + pointX * cos - pointY * sin, y + pointX * sin + pointY * cos];
  });
};

// How much of excess speed a thing keeps each sixtieth of a second while it
// settles back to its top speed. Steep, so a launch or road fling is brief.
const maxSpeedDrag = 0.9;

/**
 * Carry a thing along by the speed it already has, dragging it back towards a
 * stop as it goes. Everything that moves does this and does it the same way,
 * whether it flies itself or was only ever shoved: the difference is in what
 * put speed into it beforehand, not in what happens to that speed afterwards.
 *
 * @param {Object} object - Anything with a place, a velocity and a `mass`.
 * @param {Number} dt - Seconds since the last update.
 */
export const move = ({ position, velocity, mass, drag = 1, maxSpeed = 272 }, dt) => {
  if (!mass) return;

  const speed = velocity.length();

  if (speed < 1) velocity.x = velocity.y = 0;

  const kept = speed > maxSpeed ?
    Math.max(maxSpeed, speed * maxSpeedDrag ** (dt * 60)) / speed :
      Math.exp(-(drag / mass) * dt);

  velocity.x *= kept;
  velocity.y *= kept;

  position.set(position.add(velocity.scale(dt)));
};
