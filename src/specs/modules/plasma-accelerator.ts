import { plasmaAcceleratorName } from './names';
import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import { plasmaExplosion } from '../effects/plasma-explosion';
import { plasmaMuzzleFlash } from '../effects/plasma-muzzle-flash';
import type { ModuleSpec } from './types';

const fireInterval = 2000;

export const plasmaAccelerator = {
  behavior: 'weapon',
  name: plasmaAcceleratorName,
  health: 0,
  healthActivated: 20,
  price: 800,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 700,
  chargeDuration: fireInterval,
  dischargeDuration: 0,
  retractionDistance: 17,
  damage: 10,
  fireInterval,
  muzzleFlash: plasmaMuzzleFlash,
  recoil: 30,
  projectile: {
    speed: 600,
    lifetime: 1800,
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
  barrelLength: 18,
  model: [
    {
      outline: false,
      color: colors.violet[0],
      rechargeDelay: fireInterval,
      rechargeColor: colors.violet[0],
      glow: {
        offset: [9, 0],
        radius: 10,
        alpha: 0.5,
        stops: [
          [0, colors.violet[2]],
          [0.2, colors.violet[2], 0.6],
          [1, colors.black[0], 0],
        ],
      },
      points: [
        [0, -3],
        [18, -3],
        [18, 3],
        [0, 3],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [0, -3],
        [18, -3],
        [18, 3],
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
        outline: false,
        color: colors.violet[2],
        rechargeDelay: (index + 1) * 500,
        rechargeColor: colors.violet[0],
        glow: {
          radius: 5,
          alpha: 0.3,
          stops: [
            [0, colors.violet[2]],
            [0.3, colors.violet[2], 0.4],
            [1, colors.black[0], 0],
          ] as [number, string, number?][],
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
