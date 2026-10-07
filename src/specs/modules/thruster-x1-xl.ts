import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleXl = {
  ...thruster,
  name: 'Thruster xl',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 11,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
