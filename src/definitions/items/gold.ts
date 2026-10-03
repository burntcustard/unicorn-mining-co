import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const gold = {
  resource: 2,
  label: 'GOLD',
  price: 30,
  points: [
    [-7, -4],
    [7, -4],
    [5, 3],
    [-5, 3],
  ],
  lines: [
    [
      [-5, -1],
      [5, -1],
    ],
  ],
  shades: colors.yellow,
  glint: true,
} satisfies ItemDefinition;
