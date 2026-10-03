import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const shieldGenerator = {
  behavior: 'shieldGenerator',
  label: 'SHIELD GENERATOR',
  health: 40,
  price: 900,
  zIndex: 1,
  shades: colors.violet,
  bounciness: 0.8,
  generatorRadius: 7,
  shieldRadius: 50,
  coverDuration: 0.2,
  unhurtWhen: 1,
} satisfies ModuleDefinition;
