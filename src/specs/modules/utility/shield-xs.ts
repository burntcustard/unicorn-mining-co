import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorXs = {
  ...shield,
  name: `${shield.name} xs`,
  health: 20,
  healthActivated: 20,
  power: 0.4,
  powerActivated: 1.2,
  price: 600,
  shieldRadius: 42,
  model: [
    {
      ...shield.model[0],
      radius: 6,
      lines: [
        [
          [-6, 0],
          [6, 0],
        ],
      ],
    },
    shield.model[1],
  ],
} satisfies ModuleSpec;
