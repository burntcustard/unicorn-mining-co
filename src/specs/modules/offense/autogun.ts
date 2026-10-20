import { colors } from '../../colors';
import type { ModuleSpec } from '../types';
import { cannonSm } from './cannon-sm';

export const autogun = {
  ...cannonSm,
  description: 'Fire a rapid stream of kinetic projectiles.',
  name: 'Autogun',
  powerActivated: 1.6,
  chargeDuration: 1000,
  dischargeDuration: 1000,
  retractionDistance: 15,
  fireInterval: 200,
  barrelLength: 22,
  model: [
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
