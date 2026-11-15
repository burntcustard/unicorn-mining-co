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
  name: 'Power Plant 2e',
  description: 'An economy power plant for medium ships.',
  mass: 350,
  price: 750,
  powerGenerated: 4.4,
  powerCapacity: 48,
} satisfies ModuleSpec;
