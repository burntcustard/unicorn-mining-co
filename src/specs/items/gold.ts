import { colors } from '../colors';
import type { ItemSpec } from './types';

export const gold = {
  resource: 2,
  name: 'Gold',
  price: 30,
  points: [
    [-6, -3.5],
    [6, -3.5],
    [7, 3.5],
    [-7, 3.5],
  ],
  lines: [
    [
      [-4, 0],
      [4, 0],
    ],
  ],
  shades: colors.yellow,
  glint: true,
} satisfies ItemSpec;
