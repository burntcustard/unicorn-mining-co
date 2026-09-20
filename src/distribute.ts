import { Vector } from './vector';
import { movePoint } from './geometry';

/**
 * Spread new round things through a circle around anything already placed.
 * Anything that lands on something else is left out.
 *
 * @param {Object[]} items
 * @param {Object} area
 * @param {Object[]} placed - Anything already there, which the new things join.
 * @param {Function} random
 * @returns {Object[]} Everything placed, old and new, with x and y assigned.
 */
export const distribute = (
  items: any[],
  { radius, density, position = Vector() }: any,
  placed: any[] = [],
  random: () => number,
) => {
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
