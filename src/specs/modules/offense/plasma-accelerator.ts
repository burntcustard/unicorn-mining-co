import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import { plasmaExplosion } from '../../effects/plasma-explosion';
import { plasmaMuzzleFlash } from '../../effects/plasma-muzzle-flash';
import type { ModuleSpec } from '../types';

export const plasmaAccelerator = {
  icon: './plasma-accelerator.svg',
  description: 'Launch a charged plasma projectile.',
  behavior: 'weapon',
  name: 'Plasma Accelerator',
  health: 0,
  healthActivated: 20,
  power: 0.2,
  powerActivated: 0.4,
  powerCharging: 3.2,
  price: 800,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 700,
  chargeDuration: 2000,
  retractionDistance: 17,
  damage: 10,
  fireInterval: 2000,
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
      rechargeDelay: 2000,
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
    {
      outline: false,
      color: colors.violet[2],
      rechargeDelay: 500,
      rechargeColor: colors.violet[0],
      glow: {
        radius: 5,
        alpha: 0.3,
        stops: [
          [0, colors.violet[2]],
          [0.3, colors.violet[2], 0.4],
          [1, colors.black[0], 0],
        ],
      },
      points: [
        [1, 1.5],
        [3, 1.5],
        [3, 3],
        [1, 3],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      rechargeDelay: 1000,
      rechargeColor: colors.violet[0],
      glow: {
        radius: 5,
        alpha: 0.3,
        stops: [
          [0, colors.violet[2]],
          [0.3, colors.violet[2], 0.4],
          [1, colors.black[0], 0],
        ],
      },
      points: [
        [4.5, 1.5],
        [6.5, 1.5],
        [6.5, 3],
        [4.5, 3],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      rechargeDelay: 1500,
      rechargeColor: colors.violet[0],
      glow: {
        radius: 5,
        alpha: 0.3,
        stops: [
          [0, colors.violet[2]],
          [0.3, colors.violet[2], 0.4],
          [1, colors.black[0], 0],
        ],
      },
      points: [
        [8, 1.5],
        [10, 1.5],
        [10, 3],
        [8, 3],
      ],
    },
  ],
} satisfies ModuleSpec;
