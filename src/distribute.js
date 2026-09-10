import { Vector, movePoint } from './vector';

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
  items,
  {
    radius,
    density,
    x = 0,
    y = 0,
  },
  placed = [],
  random,
) => {
  items.forEach((item) => {
    const spread = radius - item.radius;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random());
    const candidate = movePoint(Vector(x, y), angle, spread * distance);
    const overlaps = placed.some((other) =>
      Math.hypot(candidate.x - other.x, candidate.y - other.y) <
        item.radius + other.radius + density);

    if (!overlaps) {
      Object.assign(item, candidate);
      placed.push(item);
    }
  });

  return placed;
};
