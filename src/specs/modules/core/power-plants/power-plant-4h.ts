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
  mass: 975,
  price: 4500,
  powerGenerated: 15.5,
  powerCapacity: 144,
} satisfies ModuleSpec;
