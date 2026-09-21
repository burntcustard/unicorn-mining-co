import { rotatePoints } from '../geometry';
import { Vector, type Vector as VectorValue } from '../vector';
import { type SimulationEvent } from '../protocol/events';
import { type Collider, type Contact, type Outline } from './physics';
import { type GameObject } from '../game-object';
import { type WorldObject } from './world';
import { damage } from '../craft/damage';

type CollisionShape = Collider & {
  parts?: CollisionShape[];
  shapePass?: number;
  shapes?: Array<Outline | undefined>;
};
type Axis = [VectorValue, boolean];
type Overlap = {
  aPart?: CollisionShape;
  bPart?: CollisionShape;
  depth: number;
  normal: VectorValue;
  point?: VectorValue;
};

const cellSize = 256;
const reach = 1 << 15;
const correctionEasing = 0.4;
const correctionSlop = 0.5;
const maxCorrection = 12;
const deadSpeed = 5;
let pass = 0;
const keyOf = (x: number, y: number) => (x + reach) * reach * 2 + y + reach;

/** Mark outside polygon edges and return groups connected by shared edges. */
export const outerEdges = (outlines: Outline[]) => {
  // oxlint-disable-next-line typescript/require-array-sort-compare -- Endpoint strings canonicalize an undirected edge.
  const edge = (from: number[], to: number[]) => String([from, to].sort());
  const sides = outlines.map((points) =>
    points.map((from, index) =>
      edge(from, points[(index + 1) % points.length]),
    ),
  );
  const all = sides.flat();
  const left = outlines.map((_, index) => index);
  const groups: number[][] = [];

  outlines.forEach(
    (points, index) =>
      (points.edges = sides[index].map(
        (side) => !all.includes(side, all.indexOf(side) + 1),
      )),
  );
  while (left.length) {
    const group = [left.pop()!];

    for (let at = 0; at < group.length; at++)
      for (let index = left.length; index--;)
        if (sides[group[at]].some((side) => sides[left[index]].includes(side)))
          group.push(left.splice(index, 1)[0]);
    groups.push(group);
  }
  return groups;
};

const placePoints = (object: CollisionShape, outline: Outline) =>
  Object.assign(rotatePoints(outline, object.rotation, object.position), {
    edges: outline.edges,
  });

const shapesOf = (object: CollisionShape) => {
  if (object.shapePass !== pass) {
    object.shapePass = pass;
    object.shapes = (object.parts || [object]).map(
      ({ outline }) => outline && placePoints(object, outline),
    );
  }
  return object.shapes!;
};

const axesOf = (points: Outline): Axis[] =>
  points.map(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];

    return [
      Vector(nextY - y, x - nextX).normalize(),
      !points.edges || points.edges[index],
    ];
  });

const cornerAxis = (points: Outline, position: VectorValue): Axis => {
  let near = Infinity;
  let result: Axis | undefined;

  points.forEach(([x, y], index) => {
    const axis = Vector(x, y).subtract(position);
    const length = axis.length();

    if (length && length < near) {
      near = length;
      result = [
        axis.normalize(length),
        !points.edges ||
          points.edges[index] ||
          points.edges[(index + points.length - 1) % points.length],
      ];
    }
  });
  return result || [Vector(1), true];
};

const spanOf = (
  object: CollisionShape,
  points: Outline | undefined,
  axis: VectorValue,
) => {
  const middle = object.position.dot(axis);

  if (!points) return [middle - object.radius, middle + object.radius];
  const values = points.map(([x, y]) => Vector(x, y).dot(axis));

  return [Math.min(...values), Math.max(...values)];
};

const overlapOf = (
  a: CollisionShape,
  b: CollisionShape,
  aPoints?: Outline,
  bPoints?: Outline,
): Overlap | undefined => {
  const axes = (aPoints ? axesOf(aPoints) : []).concat(
    bPoints ? axesOf(bPoints) : [],
  );

  if (!aPoints)
    axes.push(
      bPoints
        ? cornerAxis(bPoints, a.position)
        : [b.position.subtract(a.position).normalize(), true],
    );
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
) =>
  points
    ? Vector(
        ...points.reduce((best, point) =>
          point[0] * normal.x + point[1] * normal.y >
          best[0] * normal.x + best[1] * normal.y
            ? point
            : best,
        ),
      )
    : object.position.add(normal.scale(object.radius));

export const hit = (a: CollisionShape, b: CollisionShape) => {
  if (b.position.distanceTo(a.position) > a.radius + b.radius) return;
  let deepest: Overlap | undefined;

  shapesOf(a).forEach((aPoints, aIndex) =>
    shapesOf(b).forEach((bPoints, bIndex) => {
      const overlap = overlapOf(a, b, aPoints, bPoints);

      if (overlap && (!deepest || overlap.depth > deepest.depth))
        deepest = {
          ...overlap,
          aPart: a.parts?.[aIndex],
          bPart: b.parts?.[bIndex],
          point:
            a.radius < b.radius
              ? contactPoint(a, aPoints, overlap.normal)
              : contactPoint(b, bPoints, overlap.normal.scale(-1)),
        };
    }),
  );
  return deepest;
};

/** Detect contacts with the original compound-shape SAT narrow phase. */
export const detectCollisions = ({ entities }: { entities: WorldObject[] }) => {
  pass++;
  const objects = entities.flatMap((entity) => entity.hitboxes());
  const cells: Record<number, CollisionShape[]> = {};
  const contacts: Contact[] = [];

  objects.forEach((object) => {
    const cellX = Math.floor(object.position.x / cellSize);
    const cellY = Math.floor(object.position.y / cellSize);

    for (let x = cellX - 1; x < cellX + 2; x++)
      for (let y = cellY - 1; y < cellY + 2; y++)
        cells[keyOf(x, y)]?.forEach((other) => {
          if (object.owner === other.owner) return;
          const overlap = hit(object, other);

          if (!overlap) return;
          const partOf = (body: CollisionShape, part?: CollisionShape) =>
            part &&
            Object.assign(Object.create(body), {
              outline: part.outline,
              part: part.part,
              parts: undefined,
              shapePass: 0,
            });

          contacts.push({
            collider: partOf(object, overlap.aPart) || object,
            depth: overlap.depth,
            normal: overlap.normal,
            other: partOf(other, overlap.bPart) || other,
            point: overlap.point!,
          });
        });
    (cells[keyOf(cellX, cellY)] ||= []).push(object);
  });
  return contacts;
};

const momentumAt = (entity: GameObject, position: VectorValue) => {
  const offset = position.subtract(entity.position);

  return Vector(-offset.y * entity.spin, offset.x * entity.spin);
};

/** Apply mass-weighted impulse and gradual positional correction to contacts. */
export const resolve = ({
  contacts,
  events,
}: {
  contacts: Contact[];
  events?: SimulationEvent[];
}) => {
  contacts.forEach(({ collider, depth, normal, other, point }) => {
    if (collider.physics === false || other.physics === false) return;
    const a = collider.owner;
    const b = other.owner;
    const aMass = a.mass ? 1 / a.mass : 0;
    const bMass = b.mass ? 1 / b.mass : 0;
    const mass = aMass + bMass;

    if (!mass) return;
    const closing =
      b.velocity
        .add(momentumAt(b, other.position))
        .subtract(a.velocity.add(momentumAt(a, collider.position)))
        .dot(normal) -
      ((collider.speed || 0) + (other.speed || 0));

    if (closing < 0) {
      const bounce =
        -closing >= deadSpeed
          ? (collider.bounciness || 0) + (other.bounciness || 0)
          : 0;
      const impulse = (-closing / mass) * (1 + bounce);
      const amount = Math.max(0, Math.round((-closing / mass - 400) / 1200));
      if (amount) {
        damage(collider.segment || collider.owner, amount);
        damage(other.segment || other.owner, amount);
      }

      a.velocity.set(a.velocity.subtract(normal.scale(impulse * aMass)));
      b.velocity.set(b.velocity.add(normal.scale(impulse * bMass)));
      events?.push({
        a: a.id,
        b: b.id,
        impact: -closing,
        position: point,
        type: 'collision',
      });
    }
    const correction =
      Math.min((depth - correctionSlop) * correctionEasing, maxCorrection) /
      mass;

    if (correction > 0) {
      a.position.set(a.position.subtract(normal.scale(correction * aMass)));
      b.position.set(b.position.add(normal.scale(correction * bMass)));
    }
  });
};
