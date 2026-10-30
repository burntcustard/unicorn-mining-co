import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import { autogunExplosion } from '../../effects/autogun-explosion';
import { autogunMuzzleFlash } from '../../effects/autogun-muzzle-flash';
import { autogunAmmo } from '../../items';
import type { ModuleSpec } from '../types';

export const autogunTurret = {
  icon: './autogun.svg',
  description: 'Fire a rapid stream of kinetic projectiles.',
  behavior: 'weapon',
  name: 'Autogun Turret',
  turret: true,
  turretTurnRate: 3,
  health: 0,
  healthActivated: 20,
  power: 0.2,
  powerActivated: 2,
  price: 750,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  activationDuration: 500,
  collisionMargin: 0,
  chargeDuration: 1000,
  dischargeDuration: 1000,
  retractionDistance: 15,
  damage: 3,
  fireInterval: 200,
  muzzleFlash: autogunMuzzleFlash,
  projectile: {
    effect: autogunExplosion,
    speed: 1000,
    lifetime: 1000,
    fadeOut: 200,
    radius: 2,
    color: colors.yellow[2],
    glow: {
      color: colors.yellow[2],
      alpha: 0.2,
      radius: 14,
    },
  },
  ammo: autogunAmmo,
  barrelLength: 22,
  model: [
    {
      outline: true,
      turretBase: true,
      radius: 6.5,
      lines: [
        [
          [0, -6.5],
          [0, 6.5],
        ],
        [
          [-6.5, 0],
          [6.5, 0],
        ],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [0, -0.5],
        [22, -0.5],
        [22, -3],
        [0, -3],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [0, 0.5],
        [22, 0.5],
        [22, 3],
        [0, 3],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [17, -4],
        [21, -4],
        [21, 4],
        [17, 4],
      ],
    },
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [0, -4],
        [4, -4],
        [4, 4],
        [0, 4],
      ],
    },
  ],
} satisfies ModuleSpec;
