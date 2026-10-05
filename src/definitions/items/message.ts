import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const message = {
  resource: 4,
  unlock: 'ORANGE',
  points: [
    [-6.5, -5],
    [6.5, -5],
    [6.5, 5],
    [-6.5, 5],
  ],
  lines: [
    [
      [-4, -1.5],
      [4, -1.5],
    ],
    [
      [-4, 1.5],
      [2, 1.5],
    ],
  ],
  shades: colors.orange,
} satisfies ItemDefinition;
