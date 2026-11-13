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
  name: 'Power Plant 3v',
  description: 'A value power plant for large ships.',
  weight: 3.4,
  price: 1500,
  powerGenerated: 11.6,
  powerCapacity: 128,
} satisfies ModuleSpec;
