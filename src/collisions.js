/**
 * Collision checking, and nothing at all about what a collision means: the
 * caller is handed the overlap and decides for itself what to do about it.
 *
 * Everything checked needs a place in the world and a `radius` that covers all
 * of it. Anything carrying an `outline` of points is then tested against that
 * exactly, and anything without one is simply the circle its radius describes.
 * Things that share an `owner`, like the pieces of one ship, are never checked
 * against each other.
 *
 * An `open` thing is reported the same as any other. Whether an overlap stops
 * anything moving is the caller's business, not this file's.
 *
 * Comparing everything to everything is hopeless in a world of tens of
 * thousands of asteroids, so things are filed into a grid of square cells and
 * only ever compared against whatever shares the nine cells around them.
 */

// World units across a cell. Two things can only find each other if their
// radiuses add up to less than one, because a search only looks at the ring of
// cells around whatever is doing the searching
const cellSize = 256;

const cells = new Map();

const cellKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

/**
 * File a thing under the cell it is sat in, and shift it along as it drifts.
 * Anything that wants to be found has to be placed first.
 */
export const place = (thing) => {
  const cell = cellKey(thing.x, thing.y);

  if (cell === thing.cell) return;

  cells.get(thing.cell)?.delete(thing);
  cells.set(cell, cells.get(cell) || new Set());
  cells.get(cell).add(thing);
  thing.cell = cell;
};

// An outline where the thing wearing it actually is, rather than around zero
const placePoints = ({ outline, rotation, x, y }) => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return outline.map(([px, py]) => [x + px * cos - py * sin, y + px * sin + py * cos]);
};

// Each edge gives an axis at right angles to it, which is where two shapes
// can be told apart if they are apart at all
const axesOf = (points) => points.map(([x, y], i) => {
  const [nextX, nextY] = points[(i + 1) % points.length];
  const length = Math.hypot(nextX - x, nextY - y);

  return [(nextY - y) / length, (x - nextX) / length];
});

// How far along an axis a shape reaches, as a near and a far mark
const spanOf = (thing, points, axisX, axisY) => {
  const middle = thing.x * axisX + thing.y * axisY;

  if (!points) return [middle - thing.radius, middle + thing.radius];

  let near = Infinity;
  let far = -Infinity;

  points.forEach(([x, y]) => {
    const along = x * axisX + y * axisY;

    near = Math.min(near, along);
    far = Math.max(far, along);
  });

  return [near, far];
};

/**
 * @returns {Object} [hit] - How deep the two are into each other, and the way
 *   out of it pointing from the first towards the second.
 */
const hit = (a, b) => {
  const gapX = b.x - a.x;
  const gapY = b.y - a.y;
  const between = Math.hypot(gapX, gapY);

  // Bounding circles throw out all but a handful of pairs for next to nothing
  if (between > a.radius + b.radius) return;

  const aPoints = a.outline && placePoints(a);
  const bPoints = b.outline && placePoints(b);
  const axes = [
    ...(aPoints ? axesOf(aPoints) : []),
    ...(bPoints ? axesOf(bPoints) : []),
    // A circle has no edges to take an axis from, so fall back on the line
    // drawn between the middles of the two
    between ? [gapX / between, gapY / between] : [1, 0],
  ];

  let depth = Infinity;
  let outX = 0;
  let outY = 0;

  const apart = axes.some(([axisX, axisY]) => {
    const [aNear, aFar] = spanOf(a, aPoints, axisX, axisY);
    const [bNear, bFar] = spanOf(b, bPoints, axisX, axisY);
    const overlap = Math.min(aFar, bFar) - Math.max(aNear, bNear);

    // One axis with daylight along it is proof they are not touching
    if (overlap <= 0) return true;

    if (overlap < depth) {
      depth = overlap;
      outX = axisX;
      outY = axisY;
    }
  });

  if (apart) return;

  // The shallowest axis is the shortest way out, turned to face the second
  const away = outX * gapX + outY * gapY < 0 ? -1 : 1;

  return { depth, other: b, x: outX * away, y: outY * away };
};

/**
 * Everything a thing is currently overlapping, whatever that may mean.
 *
 * @param {Object} thing
 * @returns {Object[]} hits
 */
export const collisions = (thing) => {
  const cellX = Math.floor(thing.x / cellSize);
  const cellY = Math.floor(thing.y / cellSize);
  const found = [];

  for (let x = cellX - 1; x < cellX + 2; x++) {
    for (let y = cellY - 1; y < cellY + 2; y++) {
      cells.get(`${x},${y}`)?.forEach((other) => {
        // A ship does not run into itself, however it is put together
        if (other === thing || (thing.owner && other.owner === thing.owner)) return;

        const overlap = hit(thing, other);

        if (overlap) found.push(overlap);
      });
    }
  }

  return found;
};
