import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const thrusterTriple = {
  behavior: 'thruster',
  label: 'THRUSTERS *3',
  health: 30,
  price: 1800,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  forwardThrust: 28,
  rotationalThrust: 24,
  offset: 14,
  flareSizes: [3, 5, 3],
  nozzleSides: [-1, 0, 1],
} satisfies ModuleDefinition;
