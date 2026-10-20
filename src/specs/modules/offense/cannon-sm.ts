import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import { autogunExplosion } from '../../effects/autogun-explosion';
import { autogunMuzzleFlash } from '../../effects/autogun-muzzle-flash';
import { autogunAmmo } from '../../items';
import type { ModuleSpec } from '../types';

export const cannonSm = {
  icon: './autogun.svg',
  name: 'Cannon sm',
  description: 'Fire one kinetic projectile per second from a slim barrel.',
  behavior: 'weapon',
  health: 0,
  healthActivated: 20,
  power: 0.1,
  powerActivated: 0.4,
  price: 600,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 500,
  damage: 3,
  fireInterval: 1000,
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
  barrelLength: 26,
  model: [
    {
      outline: false,
      color: colors.violet[2],
      points: [
        [0, -1.5],
        [26, -1.5],
        [26, 1.5],
        [0, 1.5],
      ],
    },
  ],
} satisfies ModuleSpec;
