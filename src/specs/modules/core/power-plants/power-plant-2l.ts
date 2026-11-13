import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel2 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant2L = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel2,
  name: 'Power Plant 2l',
  description: 'A lightweight power plant for medium ships.',
  weight: 1.3,
  price: 1875,
  powerGenerated: 6.3,
  powerCapacity: 64,
} satisfies ModuleSpec;
