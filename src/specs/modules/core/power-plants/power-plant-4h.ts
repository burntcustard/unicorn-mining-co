import { colors } from '../../../colors';
import { renderingLayers } from '../../../rendering-layers';
import { powerPlantModel4 } from './power-plant-model';
import type { ModuleSpec } from '../../types';

export const powerPlant4H = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  zIndex: renderingLayers.modulesInsideShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: powerPlantModel4,
  name: 'Power Plant 4h',
  description: 'A heavy-duty power plant for extra-large ships.',
  weight: 6.4,
  price: 4500,
  powerGenerated: 26.7,
  powerCapacity: 256,
} satisfies ModuleSpec;
