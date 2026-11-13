import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel3 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant3H = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel3,
  name: 'Power Plant 3h',
  description: 'A heavy-duty power plant for large ships.',
  weight: 4.8,
  price: 2250,
  powerGenerated: 13.3,
  powerCapacity: 128,
} satisfies ModuleSpec;
