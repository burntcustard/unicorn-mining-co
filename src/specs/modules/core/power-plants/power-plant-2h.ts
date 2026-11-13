import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel2 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant2H = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel2,
  name: 'Power Plant 2h',
  description: 'A heavy-duty power plant for medium ships.',
  weight: 3.2,
  price: 1125,
  powerGenerated: 6.7,
  powerCapacity: 64,
} satisfies ModuleSpec;
