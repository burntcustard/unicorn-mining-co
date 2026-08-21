import { Vector } from 'kontra';
import { rotatePoints } from './vector';

/**
 * Collision checking, and nothing at all about what a collision means: the
 * caller is handed the overlap and decides for itself what to do about it.
 *
 * There are two shapes and no others. Anything with an `outline` of points is
 * tested against those exactly, anything without is the circle its `radius`
 * describes, and a scoop door is a long thin rectangle rather than a case of
 * its own. Pieces sharing an `owner` never check against each other, and an
 * `open` thing is reported like any other.
 *
 * The test is the separating axis theorem, laid out as Matter.js and SAT.js
 * lay it out: two shapes are apart if there is any line they can both be
 * flattened onto without touching, and the lines worth trying are the ones
 * square to their edges. Where none tells them apart, the least overlap of the
 * lot is the shortest way back out.
 *
 * Comparing everything to everything is hopeless with tens of thousands of
 * asteroids about, so things are filed into a grid of square cells and only
 * compared against whatever shares the nine cells around them.
 */

// World units across a cell. Two things only find each other if their radiuses
// add up to less than one, since a search looks at the ring of cells around it
const cellSize = 256;

// How far either side of nothing a cell may sit and still key to a whole
// number. Keys are numbers rather than strings of their two coordinates:
// building one string per thing per frame costs more than everything else the
// grid does put together once there are thousands of things in it
const reach = 1 << 15;

const cells = new Map();
const keyOf = (cellX, cellY) => (cellX + reach) * reach * 2 + cellY + reach;
const cellKey = (x, y) => keyOf(Math.floor(x / cellSize), Math.floor(y / cellSize));

// File an object under the cell it currently sits in
const addToWorld = (object) => {
  const cell = cellKey(object.x, object.y);
  const sharing = cells.get(cell);

  if (sharing) sharing.add(object);
  else cells.set(cell, new Set([object]));
};

// An outline where the thing wearing it actually is, rather than around zero
const placePoints = ({ outline, rotation, x, y }) => rotatePoints(outline, rotation, x, y);

// Each edge gives an axis at right angles to it, which is where two shapes
// can be told apart if they are apart at all
const axesOf = (points) => points.map(([x, y], i) => {
  const [nextX, nextY] = points[(i + 1) % points.length];

  return Vector(nextY - y, x - nextX).normalize();
});

// A circle brings no edges of its own, so the one axis it needs is the one
// running out to the nearest corner of whatever it is up against
const cornerAxis = (points, x, y) => {
  let near = Infinity;
  let axis = Vector(1, 0);

  points.forEach(([px, py]) => {
    const away = Vector(px - x, py - y);
    const length = away.length();

    if (length && length < near) {
      near = length;
      axis = away.normalize();
    }
  });

  return axis;
};
// How far along an axis a shape reaches, as a near and a far mark
const spanOf = (object, points, axis) => {
  const middle = Vector(object).dot(axis);

  if (!points) return [middle - object.radius, middle + object.radius];

  let near = Infinity;
  let far = -Infinity;

  points.forEach(([x, y]) => {
    const along = Vector(x, y).dot(axis);

    near = Math.min(near, along);
    far = Math.max(far, along);
  });

  return [near, far];
};

// How deep the two are into each other, and the way out of it pointing from
// the first towards the second
export const hit = (a, b) => {
  const gapX = b.x - a.x;
  const gapY = b.y - a.y;
  const between = Math.hypot(gapX, gapY);

  // Bounding circles throw out all but a handful of pairs for next to nothing
  if (between > a.radius + b.radius) return;

  const aPoints = a.outline && placePoints(a);
  const bPoints = b.outline && placePoints(b);
  const middles = between ? Vector(gapX, gapY).normalize() : Vector(1, 0);
  const axes = [
    ...(aPoints ? axesOf(aPoints) : []),
    ...(bPoints ? axesOf(bPoints) : []),
  ];

  if (!aPoints) axes.push(bPoints ? cornerAxis(bPoints, a.x, a.y) : middles);
  if (!bPoints) axes.push(aPoints ? cornerAxis(aPoints, b.x, b.y) : middles);

  let depth = Infinity;
  let outX = 0;
  let outY = 0;

  const apart = axes.some((axis) => {
    const [aNear, aFar] = spanOf(a, aPoints, axis);
    const [bNear, bFar] = spanOf(b, bPoints, axis);
    // How far the second would have to shift each way along this axis to be
    // clear of the first. The shorter of the two is the way out, and which of
    // them it is says which way round the pair come apart, which is how both
    // SAT.js and Matter.js settle it. Nothing here asks where either of them
    // is: a scoop door hangs a long way off the mount it is pinned to, so its
    // middle says nothing useful about which side of it anything is
    const onwards = aFar - bNear;
    const backwards = bFar - aNear;
    const overlap = Math.min(onwards, backwards);

    if (overlap < depth) {
      const facing = onwards < backwards ? 1 : -1;

      depth = overlap;
      outX = axis.x * facing;
      outY = axis.y * facing;
    }

    // One axis with daylight along it is proof they are not touching
    return overlap <= 0;
  });

  if (apart) return;

  return { depth, other: b, x: outX, y: outY };
};

/**
 * @param {Object} object
 * @returns {Object[]} hits - Everything it is currently overlapping.
 */
export const collisions = (object) => {
  const cellX = Math.floor(object.x / cellSize);
  const cellY = Math.floor(object.y / cellSize);
  const found = [];

  for (let x = cellX - 1; x < cellX + 2; x++) {
    for (let y = cellY - 1; y < cellY + 2; y++) {
      cells.get(keyOf(x, y))?.forEach((other) => {
        // Test each pair once, and never pieces of the same assembled body
        if (other.order >= object.order ||
          (object.owner || object) === (other.owner || other)) return;

        const overlap = hit(object, other);

        if (overlap) {
          overlap.collider = object;
          found.push(overlap);
        }
      });
    }
  }

  return found;
};

/**
 * Every overlap in a world, once per collider pair for this physics step.
 * Rebuilding the small grid also drops colliders removed since the last step.
 *
 * @param {Object[]} objects
 * @returns {Object[]} contacts
 */
export const contacts = (objects) => {
  cells.clear();
  objects.forEach((object, order) => {
    object.order = order;
    addToWorld(object);
  });

  return objects.flatMap(collisions);
};
