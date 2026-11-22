import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterSingleMd = {
  ...thruster,
  mass: 315,
  name: 'Thruster md',
  health: 15,
  power: 1.1,
  powerActivated: 1.1,
  price: 500,
  fuelUsage: 2.1 / 60,
  forwardThrust: 16,
  rotationalThrust: 12,
  model: [
    {
      outline: true,
      flareSize: 7,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
