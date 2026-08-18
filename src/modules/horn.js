// Mining horn
// Starts a lineWidth ahead of its mount, so that where a mount sits on the
// hull nose the two strokes touch exactly
const hornBase = 3;
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
 * @param {Object} segment - Holds the rotation of the horn as `phase`, 0 to 1.
 */
const fluteLines = ({ phase }) => Array.from({ length: fluteCount }, (_, i) => {
  const middle = hornBase + (i - 1 + phase) * fluteSpacing;
  const reach = hornHalfWidth / fluteSlope;

  return [
    [middle - reach, -hornHalfWidth],
    [middle + reach, hornHalfWidth],
  ];
});

export const horn = {
  health: 30,
  lines: fluteLines,
  name: 'Mining horn',
  points: [[hornBase, -hornHalfWidth], [hornBase + hornLength, 0], [hornBase, hornHalfWidth]],
  price: 350,
  state: () => ({ phase: 0 }),
  switched: true,
  update: (segment, dt) => {
    segment.phase = (segment.phase + dt * spinRate * segment.anim) % 1;
  },
  zIndex: 1,
};
