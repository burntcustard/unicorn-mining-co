import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel1 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant1A = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel1,
  name: 'Power Plant 1a',
  description: 'An advanced power plant for small ships.',
  mass: 150,
  price: 2250,
  powerGenerated: 5.6,
  powerCapacity: 32,
} satisfies ModuleSpec;
