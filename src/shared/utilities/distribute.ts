import { Vector, type Vector as VectorValue } from '../vector';
import { movePoint } from '../geometry';

export interface DistributionArea {
  radius: number;
  density: number;
  position?: VectorValue;
}

type RoundObject = { radius: number; position: VectorValue };

/**
 * Spread new round things through a circle around anything already placed.
 * Anything that lands on something else is left out.
 *
 * placed: Anything already there, which the new things join.
 * Returns all placed objects, old and new, with their positions assigned.
 */
export const distribute = <T extends RoundObject>(
  items: T[],
  { radius, density, position = Vector() }: DistributionArea,
  placed: T[] = [],
  random: () => number,
): T[] => {
  items.forEach((item) => {
    const spread = radius - item.radius;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random());
    const candidate = movePoint(position, angle, spread * distance);
    const overlaps = placed.some(
      (other) =>
        candidate.distanceTo(other.position) <
        item.radius + other.radius + density,
    );

    if (!overlaps) {
      item.position = candidate;
      placed.push(item);
    }
  });

  return placed;
};
