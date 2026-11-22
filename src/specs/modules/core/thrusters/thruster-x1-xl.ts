import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterSingleXl = {
  ...thruster,
  mass: 470,
  name: 'Thruster xl',
  health: 15,
  power: 1.8,
  powerActivated: 1.8,
  price: 1070,
  fuelUsage: 3.1 / 60,
  forwardThrust: 24,
  rotationalThrust: 16,
  model: [
    {
      outline: true,
      flareSize: 11,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
