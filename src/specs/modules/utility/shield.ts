import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

export const shield = {
  icon: './shield.svg',
  description: 'Project a protective shield around your ship.',
  behavior: 'shieldGenerator',
  name: 'Shield Generator',
  rechargeDuration: 10000,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  bounciness: 0.8,
  coverDuration: 200,
  model: [
    {
      outline: true,
      radius: 7,
      lines: [
        [
          [-7, 0],
          [7, 0],
        ],
        [
          [0, -7],
          [0, 7],
        ],
      ],
    },
    {
      outline: true,
      covers: true,
      fillAlpha: 0.1,
    },
  ],
} satisfies Partial<ModuleSpec>;
