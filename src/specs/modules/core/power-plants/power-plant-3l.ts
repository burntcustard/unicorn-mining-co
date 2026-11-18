import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel3 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant3L = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel3,
  name: 'Power Plant 3l',
  description: 'A lightweight power plant for large ships.',
  mass: 305,
  price: 3750,
  powerGenerated: 11.0,
  powerCapacity: 80,
} satisfies ModuleSpec;
