import { thruster } from './thruster';
import type { ModuleSpec } from '../types';

export const thrusterSingleSm = {
  ...thruster,
  name: 'Thruster sm',
  health: 15,
  power: 0.6,
  powerActivated: 0.6,
  price: 200,
  fuelUsage: 2.2 / 60,
  forwardThrust: 12,
  rotationalThrust: 12,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
