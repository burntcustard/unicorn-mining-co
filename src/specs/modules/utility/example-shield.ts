import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

// Synthetic covers and independent health pools, outside the playable catalog.
export const exampleShield = {
  icon: './shield.svg',
  description: 'Synthetic shield for mechanics tests.',
  behavior: 'shieldGenerator',
  name: 'Example Shield',
  health: 40,
  healthActivated: 100,
  rechargeDuration: 10000,
  power: 0.2,
  powerActivated: 1.2,
  price: 900,
  shieldRadius: 50,
  coverDuration: 200,
  bounciness: 0.8,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  model: [
    { outline: true, radius: 7 },
    { outline: true, covers: true, fillAlpha: 0.1 },
  ],
} satisfies ModuleSpec;

export const exampleLargeShield = {
  ...exampleShield,
  name: 'Example Large Shield',
  shieldRadius: 60,
} satisfies ModuleSpec;
