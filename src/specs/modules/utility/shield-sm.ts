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
      lines: Array.from({ length: 3 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 3 + Math.PI / 2;

        return [
          [0, 0],
          [Math.cos(angle) * 6.5, Math.sin(angle) * 6.5],
        ];
      }),
    },
    shield.model[1],
  ],
} satisfies ModuleSpec;
