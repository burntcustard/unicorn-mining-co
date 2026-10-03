import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const diamond = {
  resource: 0,
  label: 'DIAMOND',
  price: 80,
  points: [
    [-3, -4],
    [3, -4],
    [6, -2],
    [0, 6],
    [-6, -2],
  ],
  fillAlpha: 6,
  shades: colors.cyan,
  glint: true,
} satisfies ItemDefinition;
