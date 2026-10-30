import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleXl = {
  ...thruster,
  name: 'Thruster xl',
  health: 15,
  power: 1.5,
  powerActivated: 1.5,
  price: 200,
  fuelUsage: 0.05,
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
