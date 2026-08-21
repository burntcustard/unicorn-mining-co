import { rotatePoint } from 'kontra';

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
const overDrag = 0.9;

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
  if (mass === undefined) return;

  const speed = velocity.length();

  if (speed < minSpeed) {
    velocity.x = 0;
    velocity.y = 0;
  } else if (speed > maxSpeed) {
    // Over its top speed, from a road's fling say, it is hauled back down hard
    // towards it rather than snapped, so coming off a fast road is a steep glide
    // and not a wall
    const kept = Math.max(maxSpeed, speed * overDrag ** (dt * 60)) / speed;

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

  for (let hop = 0; hop < hops; hop++) {
    slow(object, step);

    object.position.set(object.position.add(object.velocity.scale(step)));

    settle?.();
  }
};
