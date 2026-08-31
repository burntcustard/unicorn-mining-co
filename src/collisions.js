import { Vector, rotatePoints } from './vector';
// @ifdef DEBUG
import { game } from './game';
// @endif

/**
 * Collision checking, and nothing at all about what a collision means: the
 * caller is handed the overlap and decides for itself what to do about it.
 *
 * Anything with an `outline` is tested as that polygon and anything without
 * is a circle. Pieces sharing an `owner` never check against each other, and
 * an `open` thing is reported like any other.
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
// number. A single numeric key avoids joining both coordinates into a string
// per thing per frame, which costs more than everything else the grid does put
// together once there are thousands of things in it
const reach = 1 << 15;

let cells = {};
let pass = 0;
const keyOf = (cellX, cellY) => (cellX + reach) * reach * 2 + cellY + reach;
const cellKey = (x, y) => keyOf(Math.floor(x / cellSize), Math.floor(y / cellSize));

/**
 * Find the boundary of shapes which tile one body. Reversed pairs cancel out
 * as internal seams; every edge left over faces the world.
 */
export const outerEdges = (outlines) => {
  const edge = (from, to) => `${from},${to}`;
  const sides = outlines.map((points) => points.map((from, i) =>
    edge(from, points[(i + 1) % points.length])));
  const backs = outlines.map((points) => points.map((from, i) =>
    edge(points[(i + 1) % points.length], from)));
  const edges = sides.flat();
  const left = outlines.map((_, i) => i);
  const groups = [];

  outlines.forEach((points, i) => points.edges = backs[i].map((back) => !edges.includes(back)));

  for (; left.length;) {
    const group = [left.pop()];

    for (let at = 0; at < group.length; at++) {
      for (let i = left.length; i--;) {
        if (sides[group[at]].some((side) => backs[left[i]].includes(side))) {
          group.push(left.splice(i, 1)[0]);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};

// An outline where the thing wearing it actually is, rather than around zero
const placePoints = ({ rotation, x, y }, outline) => Object.assign(
  rotatePoints(outline, rotation, x, y), { edges: outline.edges });

const shapesOf = (object) => {
  if (!object.outline) return [undefined];

  if (object.shapePass !== pass) {
    object.shapePass = pass;
    object.shapes = [placePoints(object, object.outline)];
  }

  return object.shapes;
};

// Each edge gives an axis at right angles to it, which is where two shapes
// can be told apart if they are apart at all
const axesOf = (points, boundary) => points.map(([x, y], i) => {
  const [nextX, nextY] = points[(i + 1) % points.length];

  return [
    Vector(nextY - y, x - nextX).normalize(),
    points.edges ? points.edges[i] : !boundary,
  ];
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

  let deepest;

  shapesOf(a).forEach((aPoints) => {
    shapesOf(b).forEach((bPoints) => {
      const overlap = overlapOf(a, b, between, gapX, gapY, aPoints, bPoints);

      if (overlap && (!deepest || overlap.depth > deepest.depth)) deepest = overlap;
    });
  });

  if (!deepest || (!a.parts && !b.parts)) return deepest;

  let narrowest;
  const aParts = a.parts || [a];
  const bParts = b.parts || [b];

  aParts.forEach((aPart) => {
    bParts.forEach((bPart) => {
      const overlap = overlapOf(a, b, between, gapX, gapY,
        aPart.outline && placePoints(a, aPart.outline), bPart.outline && placePoints(b, bPart.outline));

      if (overlap && overlap.depth < Infinity && (!narrowest || overlap.depth > narrowest.depth)) {
        Object.assign(overlap, { aPart: a.parts && aPart, bPart: b.parts && bPart });
        narrowest = overlap;
      }
    });
  });

  return narrowest;
};

const overlapOf = (a, b, between, gapX, gapY, aPoints, bPoints) => {
  const middles = between ? Vector(gapX, gapY).normalize() : Vector(1, 0);
  // Once a tiled body's boundary is known, every other axis only proves an
  // overlap; it cannot push something further into a seam between its tiles.
  const boundary = aPoints?.edges || bPoints?.edges;
  const axes = [
    ...(aPoints ? axesOf(aPoints, boundary) : []),
    ...(bPoints ? axesOf(bPoints, boundary) : []),
  ];

  if (!aPoints) axes.push([bPoints ? cornerAxis(bPoints, a.x, a.y) : middles, !boundary]);
  if (!bPoints) axes.push([aPoints ? cornerAxis(aPoints, b.x, b.y) : middles, !boundary]);

  let depth = Infinity;
  let outX = 0;
  let outY = 0;

  const apart = axes.some(([axis, physics]) => {
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

    if (physics && overlap < depth) {
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
 * Every overlap in a world, once per collider pair for this physics step.
 * Rebuilding the small grid also drops colliders removed since the last step.
 *
 * @param {Object[]} sprites
 * @returns {Object[]} contacts
 */
export const detectCollisions = (sprites) => {
  // @ifdef DEBUG
  if (!game.physicsOn) return [];
  // @endif

  pass++;
  cells = {};
  const objects = sprites.flatMap((sprite) => sprite.hitboxes());
  const found = [];

  objects.forEach((object, order) => {
    object.order = order;
    const cell = cellKey(object.x, object.y);

    (cells[cell] ||= []).push(object);
  });

  objects.forEach((object) => {
    const cellX = Math.floor(object.x / cellSize);
    const cellY = Math.floor(object.y / cellSize);

    for (let x = cellX - 1; x < cellX + 2; x++) {
      for (let y = cellY - 1; y < cellY + 2; y++) {
        cells[keyOf(x, y)]?.forEach((other) => {
          // Test each pair once, and never pieces of the same assembled body
          if (other.order >= object.order ||
            (object.owner || object) === (other.owner || other)) return;

          const overlap = hit(object, other);

          if (overlap) {
            const partOf = (body, part) => part && Object.assign(Object.create(body), {
              outline: part.outline,
              segment: part,
              shapePass: 0,
            });

            overlap.collider = partOf(object, overlap.aPart) || object;
            overlap.other = partOf(other, overlap.bPart) || other;
            found.push(overlap);
          }
        });
      }
    }
  });
  return found;
};
