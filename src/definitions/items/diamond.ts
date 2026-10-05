import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const diamond = {
  resource: 0,
  label: 'DIAMOND',
  price: 80,
  points: [
    [-3, -4],
    [3, -4],
    [5.5, -1],
    [0, 6],
    [-5.5, -1],
  ],
  fillAlpha: 6,
  shades: colors.cyan,
  glint: true,
} satisfies ItemDefinition;
