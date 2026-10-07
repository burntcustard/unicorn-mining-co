import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleLg = {
  ...thruster,
  name: 'Thruster lg',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 9,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
