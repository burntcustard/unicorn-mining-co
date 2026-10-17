import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterDualLg = {
  ...thruster,
  name: 'Dual Thruster lg',
  health: 22,
  power: 3.2,
  powerActivated: 3.2,
  price: 575,
  fuelUsage: 3.6 / 60,
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
