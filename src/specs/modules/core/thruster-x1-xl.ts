import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleXl = {
  ...thruster,
  name: 'Thruster xl',
  health: 15,
  power: 0.25,
  powerActivated: 2,
  price: 200,
  fuelUsage: 3.1 / 60,
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
