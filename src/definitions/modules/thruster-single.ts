import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const thrusterSingle = {
  behavior: 'thruster',
  label: 'THRUSTERS *1 XL',
  health: 15,
  price: 200,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  forwardThrust: 22,
  rotationalThrust: 14,
  flareSizes: [7],
  nozzleSides: [0],
} satisfies ModuleDefinition;
