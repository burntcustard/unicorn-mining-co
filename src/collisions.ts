import { Vector, type Vector as VectorValue } from './vector';
// @ifdef DEBUG
import { game } from './game';
// @endif
import { rotatePoints } from './geometry';
import {
  type Collider,
  type Contact,
  type Outline,
  type Point,
  type WorldObject,
} from './types';

type CollisionShape = Collider & {
  outline?: Outline;
  parts?: CollisionShape[];
  shapePass?: number;
  shapes?: Array<Outline | undefined>;
};

type Axis = [VectorValue, boolean];
type Overlap = {
  aPart?: CollisionShape;
  bPart?: CollisionShape;
  collider?: Collider;
  depth: number;
  normal: VectorValue;
  other?: Collider;
  point?: Point;
};

/**
 * Broad-phase grid and convex narrow-phase collision detection. Complex bodies
 * stay as one entry in the grid, then their convex `parts` are tested directly.
 * Edges shared by parts still separate the pieces, but never become a physical
 * contact normal; this makes the pieces behave as one continuous body.
 */

const cellSize = 256;
const reach = 1 << 15;

let pass = 0;
const keyOf = (x: number, y: number) => (x + reach) * reach * 2 + y + reach;

/**
 * Mark the outside edges of shapes which tile a body and return connected
 * groups of them. Exact reversed pairs are internal seams.
 */
export const outerEdges = (outlines: Outline[]) => {
  // oxlint-disable-next-line typescript/require-array-sort-compare -- Sort endpoint strings to canonicalize an undirected edge key.
  const edge = (from: Point, to: Point) => String([from, to].sort());
  const sides = outlines.map((points) =>
    points.map((from, i) => edge(from, points[(i + 1) % points.length])),
  );
  const all = sides.flat();
  const left = outlines.map((_, i) => i);
  const groups = [];

  outlines.forEach(
    (points, i) =>
      (points.edges = sides[i].map(
        (side) => !all.includes(side, all.indexOf(side) + 1),
      )),
  );

  while (left.length) {
    const group = [left.pop()];

    for (let at = 0; at < group.length; at++) {
      for (let i = left.length; i--;) {
        if (sides[group[at]].some((side) => sides[left[i]].includes(side))) {
          group.push(left.splice(i, 1)[0]);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};

const placePoints = (object: CollisionShape, outline: Outline) =>
  Object.assign(rotatePoints(outline, object.rotation, object.position), {
    edges: outline.edges,
  });

// Cache every convex piece in world space for this collision pass. Unlike the
// old two-stage test, a concave whole outline is never fed to SAT.
const shapesOf = (object: CollisionShape) => {
  if (object.shapePass !== pass) {
    object.shapePass = pass;
    object.shapes = (object.parts || [object]).map(
      ({ outline }) => outline && placePoints(object, outline),
    );
  }

  return object.shapes;
};

// Axes perpendicular to polygon faces. Internal edges remain separating axes,
// but only boundary edges are allowed to supply the response direction.
const axesOf = (points: Outline): Axis[] =>
  points.map(([x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length];

    return [
      Vector(nextY - y, x - nextX).normalize(),
      !points.edges || points.edges[i],
    ];
  });

// A circle needs the axis to its nearest polygon vertex. A boundary vertex is
// physical when either face meeting there is exposed, which gives a stable
// radial normal at an asteroid point instead of alternating face normals.
const cornerAxis = (points: Outline, position: VectorValue): Axis => {
  let near = Infinity;
  let result: Axis | undefined;

  points.forEach(([px, py]: number[], i: number) => {
    const axis = Vector(px, py).subtract(position);
    const length = axis.length();

    if (length && length < near) {
      near = length;
      result = [
        axis.normalize(length),
        !points.edges ||
          points.edges[i] ||
          points.edges[(i + points.length - 1) % points.length],
      ];
    }
  });
  return result || [Vector(1, 0), true];
};

const spanOf = (
  object: CollisionShape,
  points: Outline | undefined,
  axis: VectorValue,
) => {
  const middle = object.position.dot(axis);

  if (!points) return [middle - object.radius, middle + object.radius];

  let near = Infinity;
  let far = -Infinity;

  points.forEach(([x, y]: number[]) => {
    const along = Vector(x, y).dot(axis);

    near = Math.min(near, along);
    far = Math.max(far, along);
  });
  return [near, far];
};

// SAT for one convex piece pair. The returned normal points from a towards b.
const overlapOf = (
  a: CollisionShape,
  b: CollisionShape,
  aPoints?: Outline,
  bPoints?: Outline,
): Overlap | undefined => {
  const axes = (aPoints ? axesOf(aPoints) : []).concat(
    bPoints ? axesOf(bPoints) : [],
  );

  if (!aPoints) {
    axes.push(
      bPoints
        ? cornerAxis(bPoints, a.position)
        : [b.position.subtract(a.position).normalize(), true],
    );
  }

  if (!bPoints && aPoints) axes.push(cornerAxis(aPoints, b.position));

  let depth = Infinity;
  let normal: VectorValue | undefined;

  const apart = axes.some(([axis, boundary]) => {
    const [aNear, aFar] = spanOf(a, aPoints, axis);
    const [bNear, bFar] = spanOf(b, bPoints, axis);
    const forwards = aFar - bNear;
    const backwards = bFar - aNear;
    const overlap = Math.min(forwards, backwards);

    if (boundary && overlap < depth) {
      depth = overlap;
      normal = axis.scale(forwards < backwards ? 1 : -1);
    }

    return overlap <= 0;
  });

  if (!apart && normal) return { depth, normal };
};

const contactPoint = (
  object: CollisionShape,
  points: Outline | undefined,
  normal: VectorValue,
): Point => {
  const { x, y } = normal;

  return points
    ? points.reduce((best, point) =>
        point[0] * x + point[1] * y > best[0] * x + best[1] * y ? point : best,
      )
    : [
        object.position.x + x * object.radius,
        object.position.y + y * object.radius,
      ];
};

/**
 * Return the deepest convex-piece overlap for a body pair. For a union of
 * pieces this is the contact that must move furthest before all touched pieces
 * are clear. Fully enclosed objects are deliberately outside the game model.
 */
export const hit = (
  a: CollisionShape,
  b: CollisionShape,
): Overlap | undefined => {
  if (b.position.distanceTo(a.position) > a.radius + b.radius) return;

  let deepest: Overlap | undefined;

  shapesOf(a).forEach((aPoints, aIndex) => {
    shapesOf(b).forEach((bPoints, bIndex) => {
      const overlap = overlapOf(a, b, aPoints, bPoints);

      if (overlap && (!deepest || overlap.depth > deepest.depth)) {
        deepest = Object.assign(overlap, {
          point:
            a.radius < b.radius
              ? contactPoint(a, aPoints, overlap.normal)
              : contactPoint(b, bPoints, overlap.normal.scale(-1)),
          aPart: a.parts?.[aIndex],
          bPart: b.parts?.[bIndex],
        });
      }
    });
  });

  if (deepest) deepest.other = b;
  return deepest;
};

/** Return every overlap in the world once for this physics step. */
export const detectCollisions = (sprites: WorldObject[]): Contact[] => {
  // @ifdef DEBUG
  if (!game.physicsOn) return [];
  // @endif

  pass++;
  const cells: Record<number, CollisionShape[]> = {};
  const objects = sprites.flatMap(
    (sprite) => sprite.hitboxes!() as CollisionShape[],
  );
  const found: Contact[] = [];

  // Only earlier objects enter the grid, preserving pair order without an index.
  objects.forEach((object) => {
    const cellX = Math.floor(object.position.x / cellSize);
    const cellY = Math.floor(object.position.y / cellSize);

    for (let x = cellX - 1; x < cellX + 2; x++) {
      for (let y = cellY - 1; y < cellY + 2; y++) {
        cells[keyOf(x, y)]?.forEach((other) => {
          if ((object.owner || object) === (other.owner || other)) return;

          const overlap = hit(object, other);

          if (overlap) {
            const partOf = (body: CollisionShape, part?: CollisionShape) =>
              part &&
              Object.assign(Object.create(body), {
                outline: part.outline,
                parts: 0,
                segment: part,
                shapePass: 0,
              });

            overlap.collider = partOf(object, overlap.aPart) || object;
            overlap.other = partOf(other, overlap.bPart) || other;
            found.push(overlap as Contact);
          }
        });
      }
    }

    (cells[keyOf(cellX, cellY)] ||= []).push(object);
  });
  return found;
};
