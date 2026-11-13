import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterSingleMd = {
  ...thruster,
  weight: 2,
  name: 'Thruster md',
  health: 15,
  power: 0.9,
  powerActivated: 0.9,
  price: 200,
  fuelUsage: 0.04,
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
