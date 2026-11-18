import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel3 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant3V = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel3,
  name: 'Power Plant 3e',
  description: 'An economy power plant for large ships.',
  mass: 515,
  price: 1500,
  powerGenerated: 10.1,
  powerCapacity: 80,
} satisfies ModuleSpec;
