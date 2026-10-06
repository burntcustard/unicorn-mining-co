import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterTriple = {
  ...thruster,
  name: 'Triple Thruster',
  health: 30,
  price: 1800,
  forwardThrust: 28,
  rotationalThrust: 24,
  offset: 14,
  flareSizes: [3, 5, 3],
  nozzleSides: [-1, 0, 1],
} satisfies ModuleSpec;
