import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const message = {
  resource: 4,
  unlock: 'ORANGE',
  points: [
    [-7, -5],
    [7, -5],
    [7, 5],
    [-7, 5],
  ],
  lines: [
    [
      [-4, -1],
      [4, -1],
    ],
    [
      [-4, 2],
      [2, 2],
    ],
  ],
  shades: colors.orange,
} satisfies ItemDefinition;
