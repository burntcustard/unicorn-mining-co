import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterTriple = {
  ...thruster,
  mass: 1080,
  name: 'Triple Thruster',
  health: 30,
  power: 2.8,
  powerActivated: 2.8,
  price: 1800,
  fuelUsage: 4.4 / 60,
  forwardThrust: 21,
  rotationalThrust: 23,
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
