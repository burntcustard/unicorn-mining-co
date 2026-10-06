import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleSm = {
  ...thruster,
  name: 'Thruster sm',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  flareSizes: [5],
  nozzleSides: [0],
} satisfies ModuleSpec;
