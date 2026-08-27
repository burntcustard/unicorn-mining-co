/**
 * Based on Kontra vector.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/vector.js
 *
 * Keeps the vector factory and the set, add, subtract, scale, normalize, dot,
 * length and distance operations used by the game. Clamp and its coordinate
 * accessors, angle, and direction are removed. `rotatePoint` and `movePoint`
 * come from Kontra helpers.js, and the game's multi-hop movement and drag are
 * added here so all vector-related work has one home:
 * https://github.com/straker/kontra/blob/main/src/helpers.js
 */

class VectorClass {
  constructor(x = 0, y = 0) {
    if (x.x !== undefined) {
      this.x = x.x;
      this.y = x.y;
    } else {
      this.x = x;
      this.y = y;
    }
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

  distance(vector) {
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

  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

export const movePoint = ({ x, y }, angle, distance) => ({
  x: x + Math.cos(angle) * distance,
  y: y + Math.sin(angle) * distance,
});

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
  return points.map(([pointX, pointY]) => {
    const point = rotatePoint({ x: pointX, y: pointY }, angle);

    return [x + point.x, y + point.y];
  });
};

// Below this a sprite is drifting slowly enough to just call it stopped
const minSpeed = 1;

// How much of its speed a thing over its top speed keeps each sixtieth of a
// second while it is dragged back down to it. Steep, so a fling off a road
// settles out in a moment, and thrust can never push a ship far past its own
// top speed before it is pulled back
const maxSpeedDrag = 0.9;

/**
 * Drag a velocity back towards a stop, and haul it back down towards the thing's
 * top speed when it is over one. How fast the drag bleeds off is the thing's own
 * `drag` set against its `mass`, so a heavy thing coasts on where a light one
 * soon stops.
 *
 * Changes the velocity rather than handing one back.
 *
 * @param {Object} object - Anything with a `velocity`, a `mass`, a `drag` and a
 *   `maxSpeed`.
 * @param {Number} dt - Seconds since the last update.
 */
export const slow = ({ velocity, mass, drag, maxSpeed }, dt) => {
  if (!mass) return;

  const speed = velocity.length();

  if (speed < minSpeed) {
    velocity.x = 0;
    velocity.y = 0;
  } else if (speed > maxSpeed) {
    // Over its top speed, from a road's fling say, it is hauled back down hard
    // towards it rather than snapped, so coming off a fast road is a steep glide
    // and not a wall
    const kept = Math.max(maxSpeed, speed * maxSpeedDrag ** (dt * 60)) / speed;

    velocity.x *= kept;
    velocity.y *= kept;
  } else {
    // Ordinary drag bleeds the speed off towards a stop, in proportion to how
    // much there is and how heavy the thing carrying it is
    const kept = Math.exp(-(drag / mass) * dt);

    velocity.x *= kept;
    velocity.y *= kept;
  }
};

// The furthest anything travels between one look at what it has run into and
// the next. Box2D caps a step the same way: past this, a thing can be one side
// of something thin before the step and the other side after, having never
// touched it at any point anything looked
export const maxHop = 4;

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
 * @param {Object} object - Anything with a place, a velocity, a `mass`, a `drag`
 *   and a `maxSpeed`.
 * @param {Number} dt - Seconds since the last update.
 * @param {Function} [settle] - Run after every hop, to put right whatever that
 *   hop has ended up inside of.
 */
export const move = (object, dt, settle) => {
  const hops = Math.max(1, Math.ceil((object.velocity.length() * dt) / maxHop));
  const step = dt / hops;

  for (let hop = hops; hop--;) {
    slow(object, step);

    object.position.set(object.position.add(object.velocity.scale(step)));

    settle?.();
  }
};
