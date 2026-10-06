import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterDualMd = {
  ...thruster,
  name: 'Dual Thruster md',
  health: 20,
  price: 350,
  forwardThrust: 16,
  rotationalThrust: 16,
  offset: 10,
  flareSizes: [4, 4],
  nozzleSides: [-1, 1],
} satisfies ModuleSpec;
