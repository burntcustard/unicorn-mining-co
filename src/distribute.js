// Enough choices to spread things out without spending long searching for a
// perfect arrangement that the game never needs
const maxAttempts = 200;

/**
 * Randomly spread existing round things through an ellipse without overlap.
 * Bigger things go first; anything for which no place is found is left out.
 *
 * @param {Object[]} items
 * @param {Object} area
 * @returns {Object[]} The instances that fitted, with x and y assigned.
 */
export const distribute = (items, { width, height = width, density = 0, x = 0, y = 0 }) => {
  const placed = [];
  const loose = [];

  items.forEach((item) => (
    item.x === undefined || item.y === undefined ? loose : placed
  ).push(item));

  loose.sort((a, b) => b.radius - a.radius).forEach((item) => {
    const radiusX = width / 2 - item.radius;
    const radiusY = height / 2 - item.radius;
    let bestPosition;
    let bestSpace = -Infinity;

    if (radiusX < 0 || radiusY < 0) return;

    for (let i = maxAttempts; i--;) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random());
      const candidate = {
        x: x + Math.cos(angle) * radiusX * distance,
        y: y + Math.sin(angle) * radiusY * distance,
      };
      const space = Math.min(...placed.map((other) =>
        Math.hypot(candidate.x - other.x, candidate.y - other.y) - item.radius - other.radius));

      if (space >= density && space > bestSpace) {
        bestPosition = candidate;
        bestSpace = space;
      }
    }

    if (bestPosition) {
      Object.assign(item, bestPosition);
      placed.push(item);
    }
  });

  return placed;
};
