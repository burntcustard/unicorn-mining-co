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
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
