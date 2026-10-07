import { thruster } from './thruster';
import type { ModuleSpec } from './types';

export const thrusterSingleSm = {
  ...thruster,
  name: 'Thruster sm',
  health: 15,
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;
