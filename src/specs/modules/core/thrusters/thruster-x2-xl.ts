import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterDualXl = {
  ...thruster,
  mass: 940,
  name: 'Dual Thruster xl',
  health: 25,
  power: 3,
  powerActivated: 3,
  price: 1600,
  fuelUsage: 4.7 / 60,
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
