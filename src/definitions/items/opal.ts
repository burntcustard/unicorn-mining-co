import { colors } from '../colors';
import type { ItemDefinition } from './types';

export const opal = {
  resource: 3,
  label: 'OPAL',
  price: 45,
  radius: 6,
  rainbow: true,
  shades: colors.white,
  glint: true,
} satisfies ItemDefinition;
