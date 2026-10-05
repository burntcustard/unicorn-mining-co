import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const thrusterDualXl = {
  behavior: 'thruster',
  label: 'THRUSTERS *2 XL',
  health: 25,
  price: 800,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  forwardThrust: 22,
  rotationalThrust: 24,
  offset: 11,
  flareSizes: [6, 6],
  nozzleSides: [-1, 1],
} satisfies ModuleDefinition;
