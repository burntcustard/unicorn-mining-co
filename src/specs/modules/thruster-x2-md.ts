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
  model: [
    {
      outline: true,
      flareSize: 4,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 4,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
