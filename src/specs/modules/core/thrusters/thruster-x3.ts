import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterTriple = {
  ...thruster,
  mass: 1060,
  name: 'Triple Thruster',
  health: 30,
  power: 3.6,
  powerActivated: 3.6,
  price: 1800,
  fuelUsage: 0.07,
  forwardThrust: 22,
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
