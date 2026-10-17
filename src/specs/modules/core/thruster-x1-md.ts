import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleMd = {
  ...thruster,
  name: 'Thruster md',
  health: 15,
  power: 1.2,
  powerActivated: 1.2,
  price: 200,
  fuelUsage: 2.5 / 60,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 7,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
