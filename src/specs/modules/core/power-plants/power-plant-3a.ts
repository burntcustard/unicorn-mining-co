import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel3 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant3A = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel3,
  name: 'Power Plant 3a',
  description: 'An advanced power plant for large ships.',
  mass: 455,
  price: 6000,
  powerGenerated: 9.1,
  powerCapacity: 80,
} satisfies ModuleSpec;
