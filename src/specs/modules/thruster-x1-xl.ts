import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleXl = {
  ...thruster,
  name: 'Thruster xl',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  flareSizes: [11],
  nozzleSides: [0],
} satisfies ModuleSpec;
