import type { ShipSpec } from './types';

// Broad twin-horn miner with two wing-mounted medium dual thrusters.
// Radius includes the large shield at its rearward mount: 73 + 1.5.
export const moth = {
  name: 'Moth',
  fuelCapacity: 180,
  cargoSpace: 20,
  drag: 0.36,
  mass: 14,
  radius: 74.5,
  turnRate: 2.4,
  initialLoadout: [
    {
      mount: 0,
      module: 'powerPlant',
    },
    {
      mount: 1,
      module: 'shieldGeneratorLg',
    },
    {
      mount: 2,
      module: 'cargoHatchPair',
    },
    {
      mount: 3,
      module: 'thrusterDualMd',
    },
    {
      mount: 4,
      module: 'hornDrill',
    },
    {
      mount: 5,
      module: 'searchLight',
    },
    {
      mount: 6,
      module: 'thrusterDualMd',
    },
    {
      mount: 7,
      module: 'hornDrill',
    },
    {
      mount: 8,
      module: 'searchLight',
    },
  ],
  hullSegments: [
    {
      health: 45,
      core: true,
      mounts: [
        [
          {
            x: -1,
            y: 0,
            fits: ['powerPlant'],
          },
        ],
        [
          {
            x: -0.5,
            y: 0,
            fits: ['shieldGeneratorLg'],
          },
        ],
        [
          {
            x: 44,
            y: 0,
            fits: ['cargoHatchPair'],
          },
        ],
      ],
      points: [
        [-9, -8],
        [14, -8],
        [44, -8],
        [44, 8],
        [14, 8],
        [-9, 8],
        [-13, 0],
      ],
    },
    {
      health: 25,
      points: [
        [-26, -64],
        [-18.1, -61],
        [-18.1, -32.6],
        [-26, -24],
      ],
      mounts: [
        [
          {
            x: -26,
            y: -44,
            fits: ['thrusterDualMd', 'thrusterDualLg'],
          },
        ],
      ],
    },
    {
      health: 25,
      points: [
        [-18.1, -61],
        [-10, -58],
        [-10, -29.9],
        [-18.1, -32.6],
      ],
    },
    {
      health: 25,
      points: [
        [-10, -58],
        [10.7, -38.8],
        [-0.7, -26.8],
        [-10, -29.9],
      ],
    },
    {
      health: 25,
      points: [
        [-26, -24],
        [-18.1, -32.6],
        [-10, -29.9],
        [-0.7, -26.8],
        [-9, -18],
      ],
    },
    {
      health: 25,
      points: [
        [-9, -18],
        [-0.7, -26.8],
        [10.7, -38.8],
        [22.4, -28],
        [12.9, -18],
      ],
    },
    {
      health: 50,
      points: [
        [-9, -18],
        [12.9, -18],
        [22.4, -28],
        [44, -8],
        [14, -8],
        [-9, -8],
      ],
      mounts: [
        [
          {
            x: 27.5,
            y: -18,
            fits: ['hornDrill'],
          },
        ],
        [
          {
            x: 33,
            y: -18,
            fits: ['searchLight'],
          },
        ],
      ],
    },
    {
      health: 25,
      points: [
        [-26, 24],
        [-18.1, 32.6],
        [-18.1, 61],
        [-26, 64],
      ],
      mounts: [
        [
          {
            x: -26,
            y: 44,
            fits: ['thrusterDualMd', 'thrusterDualLg'],
          },
        ],
      ],
    },
    {
      health: 25,
      points: [
        [-18.1, 32.6],
        [-10, 29.9],
        [-10, 58],
        [-18.1, 61],
      ],
    },
    {
      health: 25,
      points: [
        [-10, 29.9],
        [-0.7, 26.8],
        [10.7, 38.8],
        [-10, 58],
      ],
    },
    {
      health: 25,
      points: [
        [-9, 18],
        [-0.7, 26.8],
        [-10, 29.9],
        [-18.1, 32.6],
        [-26, 24],
      ],
    },
    {
      health: 25,
      points: [
        [12.9, 18],
        [22.4, 28],
        [10.7, 38.8],
        [-0.7, 26.8],
        [-9, 18],
      ],
    },
    {
      health: 50,
      points: [
        [-9, 8],
        [14, 8],
        [44, 8],
        [22.4, 28],
        [12.9, 18],
        [-9, 18],
      ],
      mounts: [
        [
          {
            x: 27.5,
            y: 18,
            fits: ['hornDrill'],
          },
        ],
        [
          {
            x: 33,
            y: 18,
            fits: ['searchLight'],
          },
        ],
      ],
    },
  ],
} satisfies ShipSpec;
