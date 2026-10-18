import { renderingLayers } from '../../rendering-layers';
import type { ModuleSpec } from '../types';

export const powerPlant = {
  icon: './power-plant.svg',
  description: 'Generate power for fitted modules.',
  name: 'Power Plant',
  behavior: 'powerPlant',
  health: 80,
  price: 750,
  power: 0,
  powerActivated: 0,
  powerGenerated: 5.8,
  powerCapacity: 64,
  zIndex: renderingLayers.modulesAboveShipHull,
  model: [],
} satisfies ModuleSpec;
