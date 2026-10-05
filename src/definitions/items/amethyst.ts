import { createPolygon } from '../geometry';
import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const amethyst = {
  resource: 1,
  label: 'AMETHYST',
  price: 45,
  points: createPolygon({ pointCount: 6, radius: 6.5 }),
  fillAlpha: 6,
  shades: colors.violet,
  glint: true,
} satisfies ItemDefinition;
