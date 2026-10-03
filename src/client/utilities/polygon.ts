import { type ShapeOutline, type Point } from '../types';

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
  // Number vertices by exact coordinates; an undirected edge is its pair.
  const vertexIds = new Map<number, Map<number, number>>();
  let vertices = 0;

  const vertex = ([x, y]: number[]) => {
    let column = vertexIds.get(x);

    if (!column) vertexIds.set(x, (column = new Map()));
    let id = column.get(y);

    if (id === undefined) column.set(y, (id = vertices++));
    return id;
  };

  const edge = (from: number[], to: number[]) => {
    const a = vertex(from);
    const b = vertex(to);

    return a < b ? a * 0x100000000 + b : b * 0x100000000 + a;
  };

  const sides = shapeOutlines.map((points) =>
    points.map((from, index) =>
      edge(from, points[(index + 1) % points.length]),
    ),
  );
  const outlinesBySide = new Map<number, number[]>();

  sides.forEach((outlineSides, index) =>
    outlineSides.forEach((side) => {
      const outlines = outlinesBySide.get(side);

      if (outlines) outlines.push(index);
      else outlinesBySide.set(side, [index]);
    }),
  );

  const neighbours = sides.map(
    (outlineSides, index) =>
      new Set(
        outlineSides.flatMap((side) =>
          outlinesBySide.get(side)!.filter((other) => other !== index),
        ),
      ),
  );
  const left = shapeOutlines.map((_, index) => index);
  const groups: number[][] = [];

  shapeOutlines.forEach((points, index) => {
    const edges = (points.edges ||= []);

    edges.length = points.length;

    sides[index].forEach((side, i) => {
      edges[i] = outlinesBySide.get(side)!.length === 1;
    });
  });

  while (left.length) {
    const group = [left.pop()!];

    for (let at = 0; at < group.length; at++) {
      for (let index = left.length; index--;) {
        if (neighbours[group[at]].has(left[index])) {
          group.push(left.splice(index, 1)[0]);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};
