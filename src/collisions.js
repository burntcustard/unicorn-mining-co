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

const cells = new Map();
const cellKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

// Filed under the cell it sits in and shifted along as it drifts. Anything
// that wants to be found has to be placed first
export const place = (thing) => {
  const cell = cellKey(thing.x, thing.y);

  if (cell === thing.cell) return;

  cells.get(thing.cell)?.delete(thing);
  cells.set(cell, cells.get(cell) || new Set());
  cells.get(cell).add(thing);
  thing.cell = cell;
};

// Out of the world for good, so that whatever scooped it up or blew it apart
// is the last thing ever to find it
export const unplace = (thing) => {
  cells.get(thing.cell)?.delete(thing);
  thing.cell = null;
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

// A circle brings no edges of its own, so the one axis it needs is the one
// running out to the nearest corner of whatever it is up against
const cornerAxis = (points, x, y) => {
  let near = Infinity;
  let axis = [1, 0];

  points.forEach(([px, py]) => {
    const awayX = px - x;
    const awayY = py - y;
    const away = Math.hypot(awayX, awayY);

    if (away && away < near) {
      near = away;
      axis = [awayX / away, awayY / away];
    }
  });

  return axis;
};
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

// How deep the two are into each other, and the way out of it pointing from
// the first towards the second
const hit = (a, b) => {
  const gapX = b.x - a.x;
  const gapY = b.y - a.y;
  const between = Math.hypot(gapX, gapY);

  // Bounding circles throw out all but a handful of pairs for next to nothing
  if (between > a.radius + b.radius) return;

  const aPoints = a.outline && placePoints(a);
  const bPoints = b.outline && placePoints(b);
  const middles = between ? [gapX / between, gapY / between] : [1, 0];
  const axes = [
    ...(aPoints ? axesOf(aPoints) : []),
    ...(bPoints ? axesOf(bPoints) : []),
  ];

  if (!aPoints) axes.push(bPoints ? cornerAxis(bPoints, a.x, a.y) : middles);
  if (!bPoints) axes.push(aPoints ? cornerAxis(aPoints, b.x, b.y) : middles);

  let depth = Infinity;
  let outX = 0;
  let outY = 0;

  const apart = axes.some(([axisX, axisY]) => {
    const [aNear, aFar] = spanOf(a, aPoints, axisX, axisY);
    const [bNear, bFar] = spanOf(b, bPoints, axisX, axisY);
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
      outX = axisX * facing;
      outY = axisY * facing;
    }

    // One axis with daylight along it is proof they are not touching
    return overlap <= 0;
  });

  if (apart) return;

  return { depth, other: b, x: outX, y: outY };
};

/**
 * @param {Object} thing
 * @returns {Object[]} hits - Everything it is currently overlapping.
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
