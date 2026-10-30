import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorLg = {
  ...shield,
  name: `${shield.name} lg`,
  health: 35,
  healthActivated: 50,
  power: 0.4,
  powerActivated: 1.5,
  price: 1500,
  shieldRadius: 74,
  model: [
    {
      ...shield.model[0],
      radius: 7.5,
      lines: [
        [
          [0, 0],
          [0, -7.5],
        ],
        [
          [0, 0],
          [7.13, -2.32],
        ],
        [
          [0, 0],
          [4.4, 6.07],
        ],
        [
          [0, 0],
          [-4.4, 6.07],
        ],
        [
          [0, 0],
          [-7.13, -2.32],
        ],
      ],
    },
    shield.model[1],
  ],
} satisfies ModuleSpec;
