import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel1 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant1V = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel1,
  name: 'Power Plant 1v',
  description: 'A value power plant for small ships.',
  weight: 1.1,
  price: 375,
  powerGenerated: 2.9,
  powerCapacity: 32,
} satisfies ModuleSpec;
