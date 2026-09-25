import * as Vec from './vector';
import { type Mount, type Outline, type Point } from './types';
import { radiusOf } from './polygon';

export const rotatePoint = ({ x, y }: Vec.Value, angle: number) => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return Vec.create(x * cos - y * sin, x * sin + y * cos);
};

export const directionOf = (angle: number) =>
  Vec.create(Math.cos(angle), Math.sin(angle));

export const movePoint = (point: Vec.Value, angle: number, distance: number) =>
  Vec.addScaled(point, directionOf(angle), distance);

/**
 * Return a point some way between two polygon points. Plain arrays keep this
 * compatible with the polygon representation: `at` 0 gives `from`, 1 gives
 * `to`, and 0.5 gives their midpoint.
 */
export const pointBetween = (from: number[], to: number[], at = 0.5) =>
  from.map((value, axis) => value + (to[axis] - value) * at);

/**
 * Rotate local polygon points around zero, then optionally move them into
 * world space. Used wherever shapes need the same coordinates after turning.
 */
export const rotatePoints = (
  points: number[][],
  angle: number,
  position = Vec.create(),
): Outline =>
  points.map(([pointX, pointY]) => {
    const point = rotatePoint(Vec.create(pointX, pointY), angle);

    return [position.x + point.x, position.y + point.y] as Point;
  }) as Outline;

// Midpoint and farthest-point distance for a nonempty outline.
export const outlineExtent = (points: Outline) => {
  const middle = points
    .reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
    .map((total) => total / points.length) as Point;

  return { middle, reach: radiusOf(points, middle) };
};

/**
 * Work out a piece's shading geometry once when it is built.
 * Points are relative to the mount's position on the craft.
 */
export const shapeOf = (
  points: Outline,
  mount: Pick<Mount, 'localPosition'> = { localPosition: Vec.create() },
) => {
  const { middle, reach } = outlineExtent(points);

  return {
    // Which way the piece looks, taken as the way out from the middle of the
    // craft towards the middle of the piece
    facing: Math.atan2(
      middle[1] + mount.localPosition.y,
      middle[0] + mount.localPosition.x,
    ),
    middle,
    // How far it reaches from its own middle, which is how wide its shading
    // has to run
    reach,
  };
};
