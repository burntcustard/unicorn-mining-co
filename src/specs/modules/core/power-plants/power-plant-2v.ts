import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel2 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant2V = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel2,
  name: 'Power Plant 2v',
  description: 'A value power plant for medium ships.',
  weight: 2.3,
  price: 750,
  powerGenerated: 5.8,
  powerCapacity: 64,
} satisfies ModuleSpec;
