import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleLg = {
  ...thruster,
  name: 'Thruster lg',
  health: 15,
  power: 1.2,
  powerActivated: 1.2,
  price: 200,
  fuelUsage: 0.05,
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
