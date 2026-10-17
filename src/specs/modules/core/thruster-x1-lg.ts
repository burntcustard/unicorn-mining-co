import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleLg = {
  ...thruster,
  name: 'Thruster lg',
  health: 15,
  power: 1.6,
  powerActivated: 1.6,
  price: 200,
  fuelUsage: 2.8 / 60,
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
