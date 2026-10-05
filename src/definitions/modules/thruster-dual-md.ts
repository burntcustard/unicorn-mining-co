import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const thrusterDualMd = {
  behavior: 'thruster',
  label: 'THRUSTERS *2',
  health: 20,
  price: 350,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  forwardThrust: 16,
  rotationalThrust: 16,
  offset: 10,
  flareSizes: [4, 4],
  nozzleSides: [-1, 1],
} satisfies ModuleDefinition;
