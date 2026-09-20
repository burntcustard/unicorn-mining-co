import { Vector, type Vector as VectorValue } from './vector';

export const rotatePoint = ({ x, y }: VectorValue, angle: number) => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return Vector(x * cos - y * sin, x * sin + y * cos);
};

export const directionOf = (angle: number) => Vector(Math.cos(angle), Math.sin(angle));

export const movePoint = (point: VectorValue, angle: number, distance: number) =>
  directionOf(angle).scale(distance).add(point);

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
export const rotatePoints = (points: number[][], angle: number, position = Vector()) =>
  points.map(([pointX, pointY]) => {
    const point = rotatePoint(Vector(pointX, pointY), angle);

    return [position.x + point.x, position.y + point.y];
  });
