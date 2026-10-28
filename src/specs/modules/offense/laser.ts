import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import { laserBeam } from '../../effects/laser-beam';
import type { ModuleSpec } from '../types';

export const laser = {
  icon: './laser.svg',
  description: 'Focus a continuous beam onto your target.',
  behavior: 'beam',
  name: 'Beam Laser',
  health: 0,
  healthActivated: 40,
  power: 0.2,
  powerActivated: 1.4,
  powerFiring: 2.8,
  price: 700,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 500,
  retractionDistance: 16,
  damage: 0.2,
  barrelLength: 23,
  reach: 700,
  beamEffect: laserBeam,
  model: [
    {
      outline: false,
      color: colors.gray[1],
      wreckageColor: colors.white[3],
      // One backing supplies the body inserts and the muzzle's light edges.
      points: [
        [13, -3],
        [21, -3],
        [21, 3],
        [13, 3],
        [13, 0.5],
        [16, 0.5],
        [16, -0.5],
        [13, -0.5],
      ],
    },
    {
      outline: false,
      color: colors.yellow[2],
      wreckageColor: colors.white[2],
      points: [
        [0, -3],
        [18, -3],
        [18, 3],
        [0, 3],
        [0, -3],
        [9, -0.5],
        [9, 0.5],
        [13, 0.5],
        [13, 1.75],
        [16, 1.75],
        [16, -1.75],
        [13, -1.75],
        [13, -0.5],
        [9, -0.5],
        [0, -3],
      ],
    },
    {
      outline: false,
      color: colors.gray[0],
      wreckageColor: colors.white[4],
      points: [
        [18, -1.75],
        [21, -1.75],
        [21, 1.75],
        [18, 1.75],
      ],
    },
    {
      outline: false,
      color: colors.yellow[2],
      wreckageColor: colors.white[2],
      points: [
        [21, -3],
        [23, -3],
        [23, 3],
        [21, 3],
      ],
    },
  ],
} satisfies ModuleSpec;
