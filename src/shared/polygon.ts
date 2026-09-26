import { type ShapeOutline, type Point } from './types';

export interface PolygonOptions {
  // Number of corners and edges.
  pointCount: number;
  // Distance of odd corners from the centre.
  radius: number;
  // Distance of even corners; defaults to radius.
  radiusEven?: number;
  // Maximum inward wander, as a fraction of the corner's radius.
  variance?: number;
  // Supply a seeded source when the shape must agree across clients.
  random?: () => number;
}

/**
 * Points spaced evenly around a circle, ready to be turned into a path.
 *
 * A plain hexagon, a jagged asteroid and a five pointed star are all the same
 * shape with different props: pull every other point in with `radiusEven` for
 * a star, and shove them all about with `variance` for an asteroid.
 */
export const createPolygon = ({
  pointCount,
  radius,
  radiusEven = radius,
  variance = 0,
  random = () => 0,
}: PolygonOptions): ShapeOutline =>
  Array.from({ length: pointCount }, (_, i) => {
    const angle = (i / pointCount) * Math.PI * 2;
    // Only ever inwards, so no point reaches past the radius the rest of the
    // world bounds this shape by.
    const wander = 1 - random() * variance;
    const reach = (i % 2 ? radius : radiusEven) * wander;

    return [Math.cos(angle) * reach, Math.sin(angle) * reach];
  });

export const radiusOf = (points: number[][], center: Point = [0, 0]) =>
  Math.max(...points.map(([x, y]) => Math.hypot(x - center[0], y - center[1])));

/**
 * Mark outside polygon edges and return groups connected by shared edges.
 */
export const outerEdges = (shapeOutlines: ShapeOutline[]) => {
  // oxlint-disable-next-line typescript/require-array-sort-compare -- Endpoint strings canonicalize an undirected edge.
  const edge = (from: number[], to: number[]) => String([from, to].sort());
  const sides = shapeOutlines.map((points) =>
    points.map((from, index) =>
      edge(from, points[(index + 1) % points.length]),
    ),
  );
  const all = sides.flat();
  const left = shapeOutlines.map((_, index) => index);
  const groups: number[][] = [];

  shapeOutlines.forEach(
    (points, index) =>
      (points.edges = sides[index].map(
        (side) => !all.includes(side, all.indexOf(side) + 1),
      )),
  );

  while (left.length) {
    const group = [left.pop()!];

    for (let at = 0; at < group.length; at++) {
      for (let index = left.length; index--;) {
        if (
          sides[group[at]].some((side) => sides[left[index]].includes(side))
        ) {
          group.push(left.splice(index, 1)[0]);
        }
      }
    }
    groups.push(group);
  }
  return groups;
};
