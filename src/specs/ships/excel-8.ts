import { powerPlantIdsBySize } from '../modules';
import type { ShipSpec } from './types';

// Center spine sections span 30, 22, and 33 units on the x-axis.
// Angled rear panel seams meet the straight back edge.
export const excel8 = {
  name: 'Excel-8',
  price: 2400,
  fuelCapacity: 120,
  cargoSpace: 6,
  drag: 1410,
  hullMass: 2200,
  radius: 52,
  angularThrust: 4175,
  turnRate: 2,
  initialLoadout: [
    { mount: 0, module: 'thrusterSingleSm' },
    { mount: 1, module: 'thrustBooster' },
    { mount: 2, module: 'thrustBooster' },
    { mount: 3, module: 'powerPlant1E' },
    { mount: 4, module: 'cargoHatchPair' },
  ],
  hullSegments: [
    {
      health: 45,
      core: true,
      points: [
        [-38, -12],
        [-32, -5],
        [-8, -5],
        [-8, 5],
        [-32, 5],
        [-38, 12],
      ],
      mounts: [
        [
          {
            x: -38,
            y: 0,
            fits: ['thrusterSingleSm', 'thrusterDualSm', 'thrusterSingleMd'],
          },
        ],
      ],
    },
    {
      health: 45,
      mounts: [[{ x: -22, y: -13, fits: ['thrustBooster'] }]],
      points: [
        [-38, -12],
        [-8, -12],
        [-4, -12],
        [14, -12],
        [8, -5],
        [-8, -5],
        [-32, -5],
      ],
    },
    {
      health: 45,
      mounts: [[{ x: -22, y: 13, fits: ['thrustBooster'] }]],
      points: [
        [-32, 5],
        [-8, 5],
        [8, 5],
        [14, 12],
        [-4, 12],
        [-8, 12],
        [-38, 12],
      ],
    },
    {
      health: 30,
      mounts: [[{ x: 2, y: 0, fits: powerPlantIdsBySize[1] }]],
      points: [
        [-8, -5],
        [8, -5],
        [14, -5],
        [14, 5],
        [8, 5],
        [-8, 5],
      ],
    },
    {
      health: 25,
      mounts: [
        [{ x: 39, y: 0, fits: ['cargoHatchPair'] }],
        [{ x: 19, y: 0, fits: ['searchLight'] }],
      ],
      points: [
        [14, -5],
        [47, -5],
        [47, 5],
        [14, 5],
      ],
    },
    {
      health: 15,
      // Pull the collision tip back without changing the painted or rear edges.
      collisionParts: [
        [
          [14, -12],
          [32, -5],
          [14, -5],
          [8, -5],
        ],
      ],
      points: [
        [14, -12],
        [47, -5],
        [14, -5],
        [8, -5],
      ],
    },
    {
      health: 15,
      collisionParts: [
        [
          [8, 5],
          [14, 5],
          [32, 5],
          [14, 12],
        ],
      ],
      points: [
        [8, 5],
        [14, 5],
        [47, 5],
        [14, 12],
      ],
    },
    {
      health: 30,
      points: [
        [-38, -35],
        [-23, -35],
        [-4, -12],
        [-8, -12],
        [-38, -12],
      ],
      mounts: [
        [{ x: -23, y: -25, fits: ['autogun', 'plasmaAccelerator', 'laser'] }],
      ],
    },
    {
      health: 30,
      points: [
        [-38, 12],
        [-8, 12],
        [-4, 12],
        [-23, 35],
        [-38, 35],
      ],
      mounts: [
        [{ x: -23, y: 25, fits: ['autogun', 'plasmaAccelerator', 'laser'] }],
      ],
    },
  ],
} satisfies ShipSpec;
