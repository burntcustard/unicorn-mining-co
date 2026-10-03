/**
 * Keep procedural geometry on its existing seeded decimal grid.
 */
export const round = (value: number) => Math.round(value * 1e8) / 1e8;

/**
 * Match Go's native ties-to-even rounding on an exact binary motion grid.
 */
export const roundMotion = (value: number) => {
  const scaled = value * 16777216;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const rounded =
    lower + +(fraction > 0.5 || (fraction === 0.5 && lower % 2 !== 0));

  return rounded === 0 && (value < 0 || Object.is(value, -0))
    ? -0
    : rounded / 16777216;
};
