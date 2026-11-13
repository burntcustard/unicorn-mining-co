import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel4 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant4L = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel4,
  name: 'Power Plant 4l',
  description: 'A lightweight power plant for extra-large ships.',
  weight: 2.6,
  price: 7500,
  powerGenerated: 25.1,
  powerCapacity: 256,
} satisfies ModuleSpec;
