import { createPolygon } from '../geometry';
import { colors } from '../colors';
import type { ItemSpec } from './types';

export const amethyst = {
  resource: 1,
  name: 'Amethyst',
  price: 45,
  points: createPolygon({ pointCount: 6, radius: 6.5 }),
  fillAlpha: 0.4,
  shades: colors.violet,
  glint: true,
} satisfies ItemSpec;
