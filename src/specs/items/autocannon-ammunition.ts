import { colors } from '../colors';
import type { ItemSpec } from './types';

export const autocannonAmmunition = {
  resource: 5,
  name: 'Autocannon Ammunition',
  price: 2,
  rounds: 200,
  points: [
    [-5, -3.5],
    [5, -3.5],
    [5, 3.5],
    [-5, 3.5],
  ],
  lines: [
    [
      [-2.5, -6],
      [2.5, -6],
    ],
  ],
  shades: colors.green,
} satisfies ItemSpec;
