import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterTriple = {
  ...thruster,
  name: 'Triple Thruster',
  health: 30,
  power: 3.6,
  powerActivated: 3.6,
  price: 1800,
  fuelUsage: 4.4 / 60,
  forwardThrust: 28,
  rotationalThrust: 24,
  offset: 14,
  model: [
    {
      outline: true,
      flareSize: 3,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
    {
      outline: true,
      flareSize: 3,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
