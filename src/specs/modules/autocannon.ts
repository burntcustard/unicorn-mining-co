import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleSpec } from './types';

export const autocannon = {
  behavior: 'weapon',
  name: 'Autocannon',
  health: 20,
  price: 600,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  damage: 4,
  fireInterval: 0.25,
  projectile: {
    speed: 600,
    lifetime: 3,
    radius: 2,
    color: colors.yellow[2],
    glow: {
      color: colors.yellow[2],
      alpha: 0.2,
      radius: 14,
    },
  },
  ammunition: 5,
  barrelLength: 16,
  model: [
    {
      outline: false,
      color: 2,
      points: [
        [0, -0.5],
        [22, -0.5],
        [22, -3],
        [0, -3],
      ],
    },
    {
      outline: false,
      color: 2,
      points: [
        [0, 0.5],
        [22, 0.5],
        [22, 3],
        [0, 3],
      ],
    },
    {
      outline: false,
      color: 2,
      points: [
        [17, -4],
        [21, -4],
        [21, 4],
        [17, 4],
      ],
    },
  ],
} satisfies ModuleSpec;
