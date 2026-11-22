import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterSingleSm = {
  ...thruster,
  mass: 160,
  name: 'Thruster sm',
  health: 15,
  power: 0.7,
  powerActivated: 0.7,
  price: 300,
  fuelUsage: 1.8 / 60,
  forwardThrust: 12,
  rotationalThrust: 10,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
