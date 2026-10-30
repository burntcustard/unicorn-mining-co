import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorSm = {
  ...shield,
  name: `${shield.name} sm`,
  health: 25,
  healthActivated: 30,
  power: 0.4,
  powerActivated: 1.3,
  price: 900,
  shieldRadius: 50,
  model: [
    {
      ...shield.model[0],
      radius: 6.5,
      lines: [
        [
          [0, 0],
          [0, 6.5],
        ],
        [
          [0, 0],
          [-5.63, -3.25],
        ],
        [
          [0, 0],
          [5.63, -3.25],
        ],
      ],
    },
    shield.model[1],
  ],
} satisfies ModuleSpec;
