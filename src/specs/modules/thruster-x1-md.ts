import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleMd = {
  ...thruster,
  name: 'Thruster md',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  flareSizes: [7],
  nozzleSides: [0],
} satisfies ModuleSpec;
