import { type Outline } from './types';

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
}: PolygonOptions): Outline =>
  Array.from({ length: pointCount }, (_, i) => {
    const angle = (i / pointCount) * Math.PI * 2;
    // Only ever inwards, so no point reaches past the radius the rest of the
    // world bounds this shape by.
    const wander = 1 - random() * variance;
    const reach = (i % 2 ? radius : radiusEven) * wander;

    return [Math.cos(angle) * reach, Math.sin(angle) * reach];
  });

export const radiusOf = (points: number[][]) =>
  Math.max(...points.map(([x, y]) => Math.hypot(x, y)));
