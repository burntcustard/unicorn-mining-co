import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterDualSm = {
  ...thruster,
  name: 'Dual Thruster sm',
  health: 18,
  power: 1.2,
  powerActivated: 1.2,
  price: 250,
  fuelUsage: 0.05,
  forwardThrust: 12,
  rotationalThrust: 12,
  offset: 8,
  model: [
    {
      outline: true,
      flareSize: 3,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 3,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
