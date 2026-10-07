import { renderingLayers } from '../rendering-layers';
import type { ModuleSpec } from './types';

export const searchLight = {
  behavior: 'searchLight',
  name: 'Search Light',
  health: 10,
  price: 450,
  zIndex: renderingLayers.scenery,
  beam: true,
  disablePhysics: true,
  reach: 400,
  spread: 35,
  corner: 10,
  model: [
    {
      // Upper swept arm.
      outline: false,
      color: 2,
      points: [
        [-2.4, -1.8],
        [4.5, 1],
        [5.3, -1],
        [-1.6, -3.8],
      ],
    },
    {
      // Lower swept arm.
      outline: false,
      color: 2,
      points: [
        [-1.6, 3.8],
        [5.3, 1],
        [4.5, -1],
        [-2.4, 1.8],
      ],
    },
    {
      // Upper sensor head.
      outline: false,
      color: 2,
      points: [
        [-3.6, -4],
        [-0.4, -4],
        [-0.4, -1.6],
        [-3.6, -1.6],
      ],
    },
    {
      // Lower sensor head.
      outline: false,
      color: 2,
      points: [
        [-3.6, 1.6],
        [-0.4, 1.6],
        [-0.4, 4],
        [-3.6, 4],
      ],
    },
    {
      // Integrated lamp head.
      outline: false,
      color: 2,
      points: [
        [3.4, -1.3],
        [8.4, -1.3],
        [8.4, 1.3],
        [3.4, 1.3],
      ],
    },
  ],
} satisfies ModuleSpec;
