import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleSpec } from './types';

export const hornDrill = {
  behavior: 'hornDrill',
  name: 'Horn Drill',
  health: 100,
  price: 350,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.yellow,
  activationDuration: 0.5,
  friction: 0.3,
  damage: 0.5,
  grinds: true,
  activationThreshold: 0.5,
  damageStepsPerSecond: 60,
  gripDecay: 0.9,
  gripScale: 0.1,
  drillTip: { position: { x: 26, y: 0 }, radius: 3 },
  points: [
    [3, -6],
    [27, 0],
    [3, 6],
  ],
} satisfies ModuleSpec;
