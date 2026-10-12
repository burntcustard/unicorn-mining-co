import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

export const cargoHatch = {
  icon: './cargo-hatch.svg',
  description: 'Collect loose ore and cargo into your hold.',
  behavior: 'cargoHatch',
  name: 'Cargo Hatch',
  health: 0,
  healthActivated: 4,
  power: 0.1,
  powerActivated: 0.2,
  price: 150,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 700,
  collectsCargo: true,
  offset: 16,
  model: [
    {
      outline: false,
      color: colors.violet[2],
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
