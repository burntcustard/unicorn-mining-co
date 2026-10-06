import { colors } from '../colors';
import type { ItemSpec } from './types';

export const diamond = {
  resource: 0,
  name: 'Diamond',
  price: 80,
  points: [
    [-3, -4],
    [3, -4],
    [5.5, -1],
    [0, 6],
    [-5.5, -1],
  ],
  fillAlpha: 0.4,
  shades: colors.cyan,
  glint: true,
} satisfies ItemSpec;
