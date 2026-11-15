import type { ModuleSpec } from '../types';
import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';

export const cargoHatchPair = {
  icon: './cargo-hatch.svg',
  behavior: 'cargoHatch',
  health: 0,
  power: 0.2,
  powerActivated: 0.4,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  activationDuration: 700,
  mass: 150,
  healthActivated: 8,
  price: 150,
  name: 'Cargo Hatch Pair',
  description: 'Two center-split doors to collect loose ore and cargo.',
  offset: 0,
  collisionMargin: 0,
  model: [
    { outline: false, color: colors.violet[2] },
    { outline: false, color: colors.violet[2] },
    {
      outline: false,
      catches: true,
      // Collect behind the door hinges, after cargo passes the visible doors.
      points: [
        [-8, -6],
        [-2, -6],
        [-2, 6],
        [-8, 6],
      ],
    },
  ],
  cargoGeometry: {
    doorWidth: 1.5,
    openingThreshold: 0.5,
    paired: true,
    length: 8,
    openAngle: 1.57,
    doorRadius: 16,
    throatRadius: 10,
  },
} satisfies ModuleSpec;
