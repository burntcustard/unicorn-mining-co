import type { ShipSpec } from './types';

// Five-panel compact craft with two interchangeable weapon/cargo hardpoints.
export const finch = {
  name: 'Finch',
  fuelCapacity: 120,
  cargoSpace: 6,
  drag: 0.56,
  mass: 9,
  radius: 40,
  turnRate: 2,
  initialLoadout: [
    {
      mount: 0,
      module: 'powerPlant',
    },
    {
      mount: 2,
      module: 'thrusterDualSm',
    },
    {
      mount: 3,
      module: 'cargoHatch',
    },
    {
      mount: 4,
      module: 'cargoHatch',
    },
  ],
  hullSegments: [
    {
      health: 45,
      core: true,
      points: [
        [5, 0],
        [-1, 14.5],
        [-14, 14.5],
        [-14, -14.5],
        [-1, -14.5],
      ],
      mounts: [
        [
          {
            x: -11,
            y: 0,
            fits: ['powerPlant'],
          },
        ],
        [
          {
            x: 0,
            y: 0,
            fits: ['shieldGeneratorXs'],
          },
        ],
        [
          {
            x: -14,
            y: 0,
            fits: ['thrusterSingleSm', 'thrusterDualSm'],
          },
        ],
      ],
    },
    {
      health: 30,
      points: [
        [7, -29],
        [19, 0],
        [5, 0],
        [-1, -14.5],
      ],
      mounts: [
        [
          {
            x: 9,
            y: -19.5,
            fits: ['cargoHatch'],
          },
          {
            x: 6,
            y: -15,
            fits: ['autogun', 'laser', 'plasmaAccelerator'],
          },
        ],
      ],
    },
    {
      health: 25,
      points: [
        [7, -29],
        [-1, -14.5],
        [-14, -14.5],
        [-6, -29],
      ],
    },
    {
      health: 30,
      points: [
        [-1, 14.5],
        [5, 0],
        [19, 0],
        [7, 29],
      ],
      mounts: [
        [
          {
            x: 9,
            y: 19.5,
            fits: ['cargoHatch'],
          },
          {
            x: 5,
            y: 15,
            fits: ['autogun', 'laser', 'plasmaAccelerator'],
          },
        ],
      ],
    },
    {
      health: 25,
      points: [
        [-6, 29],
        [-14, 14.5],
        [-1, 14.5],
        [7, 29],
      ],
    },
  ],
} satisfies ShipSpec;
