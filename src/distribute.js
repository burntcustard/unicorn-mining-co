// Enough choices to spread things out without spending long searching for a
// perfect arrangement that the game never needs
const maxAttempts = 200;

/**
 * Spread new round things through an ellipse around anything already placed.
 * Bigger things go first; anything for which no place is found is left out.
 *
 * @param {Object[]} items
 * @param {Object} area
 * @param {Object[]} placed
 * @param {Object[]} avoid
 * @param {Function} random
 * @returns {Object[]} The instances that fitted, with x and y assigned.
 */
export const distribute = (
  items,
  {
    radius,
    aspectRatio = 1,
    density = 0,
    variance = 0,
    rotation = 0,
    x = 0,
    y = 0,
  },
  placed = [],
  avoid = [],
  random = Math.random,
) => {
  items.sort((a, b) => b.radius - a.radius).forEach((item) => {
    const itemRadius = item.collisionRadius || item.radius;
    const radiusX = radius - itemRadius;
    const radiusY = radius * aspectRatio - itemRadius;

    if (radiusX < 0 || radiusY < 0) return;

    for (let i = maxAttempts; i--;) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random());
      const localX = Math.cos(angle) * radiusX * distance;
      const localY = Math.sin(angle) * radiusY * distance;
      const candidate = {
        x: x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
        y: y + localX * Math.sin(rotation) + localY * Math.cos(rotation),
      };
      const requiredSpace = density - random() * variance;
      const overlaps = [...placed, ...avoid].some((other) => {
        const otherRadius = other.collisionRadius || other.radius;

        return (
          Math.hypot(candidate.x - other.x, candidate.y - other.y) <
            itemRadius + otherRadius + requiredSpace
        );
      });

      if (!overlaps) {
        Object.assign(item, candidate);
        placed.push(item);
        break;
      }
    }
  });

  return placed;
};
