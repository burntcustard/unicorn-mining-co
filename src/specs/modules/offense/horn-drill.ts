import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

export const hornDrill = {
  icon: './horn-drill.svg',
  description: 'Cut into asteroids to break off rock and extract ore.',
  behavior: 'hornDrill',
  name: 'Horn Drill',
  health: 80,
  power: 0.1,
  powerActivated: 3.6,
  price: 350,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.yellow,
  activationDuration: 500,
  friction: 0.3,
  damage: 1,
  grinds: true,
  activationThreshold: 0.5,
  damageStepsPerSecond: 30,
  gripDecay: 0.81,
  gripScale: 0.1,
  drillTip: { position: { x: 26, y: 0 }, radius: 3 },
  model: [
    {
      outline: true,
      points: [
        [3, -6],
        [27, 0],
        [3, 6],
      ],
    },
  ],
} satisfies ModuleSpec;
