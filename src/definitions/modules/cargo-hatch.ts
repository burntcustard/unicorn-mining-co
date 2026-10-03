import { colors } from '../colors';
import type { ModuleDefinition } from './types';

export const cargoHatch = {
  behavior: 'cargoHatch',
  label: 'CARGO HATCH',
  health: 4,
  price: 150,
  zIndex: -1,
  shades: colors.violet,
  activationDuration: 0.7,
  collectsCargo: true,
  unhurtWhen: 0,
  cargoGeometry: {
    length: 16,
    openAngle: 2.5,
    doorWidth: 1.5,
    doorRadius: 32,
    openingThreshold: 0.5,
    throatRadius: 12,
  },
} satisfies ModuleDefinition;
