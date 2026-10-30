import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterDualXl = {
  ...thruster,
  name: 'Dual Thruster xl',
  health: 25,
  power: 3,
  powerActivated: 3,
  price: 800,
  fuelUsage: 0.07,
  forwardThrust: 22,
  rotationalThrust: 24,
  offset: 11,
  model: [
    {
      outline: true,
      flareSize: 6,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 6,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
