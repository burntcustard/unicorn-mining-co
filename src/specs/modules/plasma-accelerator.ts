import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import { plasmaExplosion } from '../effects/plasma-explosion';
import type { ModuleSpec } from './types';

export const plasmaAccelerator = {
  behavior: 'weapon',
  name: 'Plasma Accelerator',
  health: 20,
  price: 800,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  damage: 10,
  fireInterval: 2,
  recoil: 30,
  projectile: {
    speed: 500,
    lifetime: 2.5,
    radius: 2.5,
    color: colors.violet[2],
    explosion: {
      radius: 24,
      impulse: 1200,
      maxSpeed: 32,
      damage: 10,
      effect: plasmaExplosion,
    },
    glow: {
      color: colors.violet[2],
      alpha: 0.3,
      radius: 20,
    },
  },
  barrelLength: 16,
  model: [
    {
      color: 0,
      points: [
        [0, -3],
        [20, -3],
        [20, 3],
        [0, 3],
      ],
    },
    {
      points: [
        [0, -3],
        [20, -3],
        [20, 3],
        [12, 3],
        [10.5, 0.5],
        [1, 0.5],
        [1, 3],
        [0, 3],
      ],
    },
    ...[0, 1, 2].map((index) => {
      const x = 1 + index * 3.5;

      return {
        color: 2,
        rechargeDelay: (index + 1) * 0.5,
        rechargeColor: 0,
        glow: {
          radius: 5,
          alpha: 0.3,
          stops: [
            [0, 2],
            [0.3, 2, 0.4],
            [1, '#000', 0],
          ] as [number, number | string, number?][],
        },
        points: [
          [x, 1.5],
          [x + 2, 1.5],
          [x + 2, 3],
          [x, 3],
        ],
      };
    }),
  ],
} satisfies ModuleSpec;
