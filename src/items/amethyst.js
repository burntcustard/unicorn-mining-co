import { colors } from '../colors';
import { createPolygon } from '../polygon';

// Amethyst
// A hexagonal crystal seen end on, part filled the way the diamond is so that
// it reads as a stone with depth in it
export const amethyst = {
  bounciness: 0.1,
  fillAlpha: 6,
  health: 40,
  name: 'AMETHYST',
  points: createPolygon({ points: 6, radius: 7 }),
  price: 45,
  shades: colors.violet,
  glint: true,
};
