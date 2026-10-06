import { colors } from '../colors';
import type { ItemSpec } from './types';

export const opal = {
  resource: 3,
  name: 'Opal',
  price: 45,
  radius: 6,
  rainbow: true,
  shades: colors.white,
  glint: true,
} satisfies ItemSpec;
