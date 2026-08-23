import { colors } from '../colors';
import { createPolygon } from '../polygon';

// Amethyst
// A hexagonal crystal seen end on, part filled the way the diamond is so that
// it reads as a stone with depth in it
export const amethyst = {
  bounciness: 0.2,
  fillAlpha: 6,
  health: 45,
  name: 'Amethyst',
  points: createPolygon({ points: 6, radius: 7 }),
  price: 300,
  shades: colors.violet,
  glint: true,
};
