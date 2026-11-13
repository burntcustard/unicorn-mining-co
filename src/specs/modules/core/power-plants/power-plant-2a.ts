import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel2 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant2A = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel2,
  name: 'Power Plant 2a',
  description: 'An advanced power plant for medium ships.',
  weight: 2,
  price: 3000,
  powerGenerated: 7.2,
  powerCapacity: 64,
} satisfies ModuleSpec;
