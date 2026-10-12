import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

export const thruster = {
  icon: './thruster.svg',
  description: 'Provide forward thrust and turning control.',
  behavior: 'thruster',
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
} satisfies Partial<ModuleSpec>;
