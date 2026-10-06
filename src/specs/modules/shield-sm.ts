import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleSpec } from './types';

export const shieldGeneratorSm = {
  behavior: 'shieldGenerator',
  name: 'Shield Generator sm',
  health: 40,
  price: 900,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  bounciness: 0.8,
  generatorRadius: 7,
  shieldRadius: 50,
  coverDuration: 0.2,
  unhurtWhen: 1,
} satisfies ModuleSpec;
