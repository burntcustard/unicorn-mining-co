import { thrusterSingleMd } from './thruster-x1-md';
import type { ModuleSpec } from '../../types';

export const thrusterCrescent = {
  ...thrusterSingleMd,
  name: 'Alien Thruster md',
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
