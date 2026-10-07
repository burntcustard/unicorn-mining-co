import { renderingLayers } from '../rendering-layers';
import { colors } from '../colors';
import type { ModuleSpec } from './types';

export const cargoHatch = {
  behavior: 'cargoHatch',
  name: 'Cargo Hatch',
  health: 4,
  price: 150,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 0.7,
  collectsCargo: true,
  offset: 16,
  unhurtWhen: 0,
  model: [
    {
      outline: false,
      color: 2,
    },
    {
      outline: false,
      catches: true,
    },
  ],
  cargoGeometry: {
    length: 16,
    openAngle: 2.5,
    doorWidth: 1.5,
    doorRadius: 32,
    openingThreshold: 0.5,
    throatRadius: 12,
  },
} satisfies ModuleSpec;
