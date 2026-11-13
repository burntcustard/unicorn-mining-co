import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel1 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant1L = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel1,
  name: 'Power Plant 1l',
  description: 'A lightweight power plant for small ships.',
  weight: 0.7,
  price: 950,
  powerGenerated: 3.1,
  powerCapacity: 32,
} satisfies ModuleSpec;
