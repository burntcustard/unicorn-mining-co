import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterSingleLg = {
  ...thruster,
  mass: 440,
  name: 'Thruster lg',
  health: 15,
  power: 1.4,
  powerActivated: 1.4,
  price: 750,
  fuelUsage: 2.4 / 60,
  forwardThrust: 20,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 9,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
