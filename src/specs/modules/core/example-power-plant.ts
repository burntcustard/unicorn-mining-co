// Test data: intentionally independent of playable module tuning.
import { renderingLayers } from '../../rendering-layers';
import type { ModuleSpec } from '../types';

export const examplePowerPlant = {
  icon: './power-plant.svg',
  description: 'Synthetic module for mechanics tests; excluded from gameplay.',
  name: 'Example Power Plant',
  behavior: 'powerPlant',
  health: 100,
  price: 750,
  power: 0,
  powerActivated: 0,
  powerGenerated: 6.4,
  zIndex: renderingLayers.modulesAboveShipHull,
  model: [],
} satisfies ModuleSpec;
