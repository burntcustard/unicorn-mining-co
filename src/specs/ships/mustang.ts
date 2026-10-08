import type { ShipSpec } from './types';

export const mustang = {
  name: 'Mustang',
  cargoSpace: 12,
  drag: 5 / 9,
  mass: 9,
  radius: 40,
  turnRate: 3,
  initialLoadout: [
    { mount: 1, module: 'thrusterDualMd' },
    { mount: 0, module: 'cargoHatch' },
    { mount: 5, module: 'cargoHatch' },
    { mount: 3, module: 'hornDrill' },
    { mount: 4, module: 'searchLight' },
  ],
  hullSegments: [
    {
      health: 8,
      points: [
        [-16, -36],
        [-4, -36],
        [-16, -20],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: 3,
            y: -29,
            fits: ['cargoHatch'],
          },
          {
            x: -2,
            y: -25,
            fits: ['autogun', 'laser'],
          },
          {
            x: 5,
            y: -25,
            fits: ['plasmaAccelerator', 'laser'],
          },
        ],
      ],
      points: [
        [-4, -36],
        [20, -12],
        [-16, -20],
      ],
    },
    {
      health: 20,
      points: [
        [-16, -20],
        [20, -12],
        [8, 0],
      ],
    },
    {
      health: 50,
      core: true,
      mounts: [
        [
          {
            x: -16,
            y: 0,
            fits: [
              'thrusterSingleMd',
              'thrusterSingleLg',
              'thrusterDualMd',
              'thrusterDualLg',
              'thrusterTriple',
            ],
          },
        ],
        [
          {
            x: 0,
            y: 0,
            fits: ['shieldGeneratorSm'],
          },
        ],
      ],
      points: [
        [-16, -20],
        [8, 0],
        [-16, 20],
      ],
    },
    {
      health: 40,
      core: true,
      mounts: [
        [
          {
            x: 20,
            y: 0,
            fits: ['hornDrill'],
          },
        ],
        [
          {
            x: 25,
            y: 0,
            fits: ['searchLight'],
          },
        ],
      ],
      points: [
        [20, -12],
        [20, 12],
        [8, 0],
      ],
    },
    {
      health: 20,
      points: [
        [8, 0],
        [20, 12],
        [-16, 20],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: 3,
            y: 29,
            fits: ['cargoHatch'],
          },
          {
            x: -2,
            y: 25,
            fits: ['autogun', 'laser'],
          },
          {
            x: 5,
            y: 25,
            fits: ['plasmaAccelerator', 'laser'],
          },
        ],
      ],
      points: [
        [-16, 20],
        [20, 12],
        [-4, 36],
      ],
    },
    {
      health: 8,
      points: [
        [-16, 20],
        [-4, 36],
        [-16, 36],
      ],
    },
  ],
} satisfies ShipSpec;
