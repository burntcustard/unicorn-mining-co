import { thruster } from './thruster';
import type { ModuleSpec } from '../../types';

export const thrusterCrescent = {
  ...thruster,
  mass: 120,
  name: 'Crescent Thruster',
  health: 15,
  power: 0.6,
  powerActivated: 0.6,
  price: 200,
  fuelUsage: 0.04,
  forwardThrust: 12,
  rotationalThrust: 10,
  model: [
    {
      outline: true,
      lineJoin: 'miter',
      lineWidth: 1.5,
      mirrorWithMount: true,
      wreckage: false,
      thrusterNozzleSide: 0,
      points: [
        [-5.84, 0.22],
        [-11.42, -9.42],
        [-3.03, -6.97],
        [0.25, -1.3],
        [0.25, 2],
      ],
    },
  ],
} satisfies ModuleSpec;
