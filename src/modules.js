/**
 * Modules are re-usable ship parts that can be damaged and destroyed.
 *
 * Some modules bring their own geometry (the horn is identical on every ship
 * that has one), others only bring rules and take their shape from the ship
 * they are attached to (every ship has a differently shaped cockpit).
 *
 * Ships reference these objects directly rather than by name, because the
 * build mangles property names but leaves string literals alone.
 */

// A ship cannot fly without somewhere to sit
export const cockpit = {
  critical: true,
};

// Only drawn while it is firing
export const thruster = {
  active: true,
  onlyWhenActive: true,
};

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
};
