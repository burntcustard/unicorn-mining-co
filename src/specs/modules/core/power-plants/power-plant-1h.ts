import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel1 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant1H = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel1,
  name: 'Power Plant 1h',
  description: 'A heavy-duty power plant for small ships.',
  weight: 1.6,
  price: 550,
  powerGenerated: 3.3,
  powerCapacity: 32,
} satisfies ModuleSpec;
