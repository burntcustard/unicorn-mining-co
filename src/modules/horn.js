// Mining horn
// Sits a lineWidth ahead of the hull nose, so the two strokes touch exactly
const hornBase = 23;
const hornLength = 24;
const hornHalfWidth = 6;

// Gap between flutes, about as wide again as the line itself
const fluteSpacing = 6;

// Steeper than the horn's edges, so the flutes read as cutting across it
const fluteSlope = 2;

const fluteCount = hornLength / fluteSpacing + 2;

// How many times a second the horn turns all the way around
const spinRate = 1.5;

/**
 * Flutes are parallel lines that march towards the tip and wrap back around,
 * which is what sells the spin. They are drawn overlong and clipped to the
 * horn, so that they all keep the same angle however wide the horn is there.
 *
 * @param {Number} phase - Rotation of the horn, 0 to 1.
 */
const fluteLines = (phase) => Array.from({ length: fluteCount }, (_, i) => {
  const middle = hornBase + (i - 1 + phase) * fluteSpacing;
  const reach = hornHalfWidth / fluteSlope;

  return [
    [middle - reach, -hornHalfWidth],
    [middle + reach, hornHalfWidth],
  ];
});

export const horn = {
  active: true,
  lines: fluteLines,
  points: [[hornBase, -hornHalfWidth], [hornBase + hornLength, 0], [hornBase, hornHalfWidth]],
  state: () => ({ phase: 0 }),
  update: (segment, dt) => {
    segment.phase = (segment.phase + dt * spinRate) % 1;
  },
};
