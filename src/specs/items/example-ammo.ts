// Synthetic ammunition for weapon mechanics tests.
import { colors } from '../colors';
import type { ItemSpec } from './types';

export const exampleAmmo = {
  resource: 5,
  name: 'Example Ammo',
  description: 'Autogun ammunition. Each pack supplies 200 rounds.',
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
