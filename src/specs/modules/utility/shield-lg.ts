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
  shieldRadius: 70,
  model: [
    {
      ...shield.model[0],
      radius: 7.5,
      lines: Array.from({ length: 5 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 5 - Math.PI / 2;

        return [
          [0, 0],
          [Math.cos(angle) * 7.5, Math.sin(angle) * 7.5],
        ];
      }),
    },
    shield.model[1],
  ],
} satisfies ModuleSpec;
