import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleSpec } from './types';

export const shield = {
  behavior: 'shieldGenerator',
  health: 40,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  bounciness: 0.8,
  coverDuration: 0.2,
  unhurtWhen: 1,
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
      fillAlpha: 2 / 15,
    },
  ],
} satisfies Partial<ModuleSpec>;
