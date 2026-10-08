import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import { laserBeam } from '../effects/laser-beam';
import type { ModuleSpec } from './types';

export const laser = {
  behavior: 'beam',
  name: 'Beam Laser',
  health: 0,
  healthActivated: 40,
  price: 700,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 500,
  retractionDistance: 15,
  damage: 0.1,
  barrelLength: 24,
  reach: 700,
  beamEffect: laserBeam,
  model: [
    {
      outline: false,
      color: colors.grey[1],
      wreckageColor: colors.white[3],
      // One backing supplies the body inserts and the muzzle's light edges.
      points: [
        [14, -3],
        [22, -3],
        [22, 3],
        [14, 3],
        [14, 0.5],
        [17, 0.5],
        [17, -0.5],
        [14, -0.5],
      ],
    },
    {
      outline: false,
      color: colors.yellow[2],
      wreckageColor: colors.white[2],
      points: [
        [0, -3],
        [19, -3],
        [19, 3],
        [0, 3],
        [0, -3],
        [10, -0.5],
        [10, 0.5],
        [14, 0.5],
        [14, 1.75],
        [17, 1.75],
        [17, -1.75],
        [14, -1.75],
        [14, -0.5],
        [10, -0.5],
        [0, -3],
      ],
    },
    {
      outline: false,
      color: colors.grey[0],
      wreckageColor: colors.white[4],
      points: [
        [19, -1.75],
        [22, -1.75],
        [22, 1.75],
        [19, 1.75],
      ],
    },
    {
      outline: false,
      color: colors.yellow[2],
      wreckageColor: colors.white[2],
      points: [
        [22, -3],
        [24, -3],
        [24, 3],
        [22, 3],
      ],
    },
  ],
} satisfies ModuleSpec;
