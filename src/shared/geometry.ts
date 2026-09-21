import { Vector, type Vector as VectorValue } from './vector';
import { type Mount, type Outline, type Point } from './types';

export const rotatePoint = ({ x, y }: VectorValue, angle: number) => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return Vector(x * cos - y * sin, x * sin + y * cos);
};

export const directionOf = (angle: number) =>
  Vector(Math.cos(angle), Math.sin(angle));

export const movePoint = (
  point: VectorValue,
  angle: number,
  distance: number,
) => directionOf(angle).scale(distance).add(point);

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
  position = Vector(),
): Outline =>
  points.map(([pointX, pointY]) => {
    const point = rotatePoint(Vector(pointX, pointY), angle);

    return [position.x + point.x, position.y + point.y] as Point;
  }) as Outline;

/**
 * Work out a piece's shading geometry once when it is built.
 * Points are relative to the mount's position on the craft.
 */
export const shapeOf = (
  points: Outline,
  mount: Pick<Mount, 'localPosition'> = { localPosition: Vector() },
) => {
  const middle = points
    .reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
    .map((total) => total / points.length) as Point;

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
    reach: Math.max(
      ...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])),
    ),
  };
};
