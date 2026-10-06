import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterDualLg = {
  ...thruster,
  name: 'Dual Thruster lg',
  health: 22,
  price: 575,
  forwardThrust: 19,
  rotationalThrust: 20,
  offset: 10.5,
  flareSizes: [5, 5],
  nozzleSides: [-1, 1],
} satisfies ModuleSpec;
