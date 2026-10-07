import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import { autogunExplosion } from '../effects/autogun-explosion';
import { autogunMuzzleFlash } from '../effects/autogun-muzzle-flash';
import type { ModuleSpec } from './types';

const activationDuration = 0.7;

export const autogun = {
  behavior: 'weapon',
  name: 'Autogun',
  health: 20,
  price: 600,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration,
  chargeDuration: activationDuration,
  retractionDistance: 12,
  unhurtWhen: 1,
  damage: 4,
  fireInterval: 0.25,
  muzzleFlash: autogunMuzzleFlash,
  projectile: {
    effect: autogunExplosion,
    speed: 1000,
    lifetime: 1,
    radius: 2,
    color: colors.yellow[2],
    glow: {
      color: colors.yellow[2],
      alpha: 0.2,
      radius: 14,
    },
  },
  ammunition: 5,
  barrelLength: 22,
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
