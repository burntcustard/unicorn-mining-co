import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel4 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant4V = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel4,
  name: 'Power Plant 4v',
  description: 'A value power plant for extra-large ships.',
  weight: 4.6,
  price: 3000,
  powerGenerated: 23.2,
  powerCapacity: 256,
} satisfies ModuleSpec;
