// Test data: intentionally independent of playable module tuning.
import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import { exampleBeamEffect } from '../../effects/example-weapon';
import type { ModuleSpec } from '../types';

export const exampleBeam = {
  icon: './laser.svg',
  description: 'Synthetic module for mechanics tests; excluded from gameplay.',
  behavior: 'beam',
  name: 'Example Beam',
  health: 0,
  healthActivated: 40,
  power: 0.2,
  powerActivated: 2.8,
  powerFiring: 9,
  price: 700,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 500,
  retractionDistance: 16,
  damage: 0.1,
  barrelLength: 15,
  reach: 700,
  beamEffect: exampleBeamEffect,
  model: [
    {
      outline: false,
      color: colors.gray[1],
      points: [
        [0, -3],
        [14, -3],
        [14, 3],
        [0, 3],
      ],
    },
    {
      outline: false,
      color: colors.yellow[2],
      points: [
        [14, -4],
        [15, -4],
        [15, 4],
        [14, 4],
      ],
    },
  ],
} satisfies ModuleSpec;
