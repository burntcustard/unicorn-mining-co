import { renderingLayers } from '../rendering-layers';
import type { ModuleDefinition } from './types';

export const searchLight = {
  behavior: 'searchLight',
  label: 'SEARCH LIGHT',
  health: 10,
  price: 450,
  zIndex: renderingLayers.scenery,
  beam: true,
  disablePhysics: true,
  lens: 2,
  mouth: 5,
  reach: 400,
  spread: 35,
  corner: 10,
} satisfies ModuleDefinition;
