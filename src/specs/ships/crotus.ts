import type { ShipSpec } from './types';

export const crotus = {
  name: 'Crotus',
  cargoSpace: 12,
  drag: 5 / 9,
  mass: 9,
  radius: 40,
  turnRate: 3,
  initialLoadout: [
    { mount: 2, module: 'thrusterDualMd' },
    { mount: 4, module: 'cargoHatch' },
    { mount: 3, module: 'cargoHatch' },
    { mount: 0, module: 'autogun' },
  ],
  hullSegments: [
    {
      health: 40,
      core: true,
      mounts: [
        [
          {
            x: 30,
            y: 0,
            fits: ['hornDrill'],
          },
          {
            x: 24,
            y: 0,
            fits: ['autogun'],
          },
        ],
        [
          {
            x: 34,
            y: 0,
            fits: ['searchLight'],
          },
        ],
      ],
      points: [
        [30, -6],
        [30, 6],
        [10, 0],
      ],
    },
    {
      health: 8,
      points: [
        [-22, -24.5],
        [-23.5, -24.5],
        [-23.5, 24.5],
        [-22, 24.5],
      ],
      mounts: [
        [
          {
            x: -26,
            y: 0,
            thrusterOffset: 8,
            fits: ['thrusterDualMd', 'thrusterDualLg'],
          },
        ],
      ],
    },
    {
      health: 8,
      points: [
        [-16, -26],
        [-16, 0],
        [-38, 0],
        [-36, -8],
        [-24, -11],
        [-22, -26],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: -7,
            y: -22,
            fits: ['cargoHatch'],
          },
          {
            x: -7,
            y: -19,
            fits: ['plasmaAccelerator'],
          },
          {
            x: -13,
            y: -19,
            fits: ['autogun'],
          },
        ],
      ],
      points: [
        [-16, -26],
        [-8, -26],
        [-4, -11],
        [-16, 0],
      ],
    },
    {
      health: 20,
      points: [
        [-16, 0],
        [-4, -11],
        [29, -6],
        [22, 0],
        [4, 0],
      ],
    },
    {
      health: 20,
      points: [
        [4, 0],
        [22, 0],
        [29, 6],
        [-4, 11],
        [-16, 0],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: -7,
            y: 22,
            fits: ['cargoHatch'],
          },
          {
            x: -7,
            y: 19,
            fits: ['plasmaAccelerator'],
          },
          {
            x: -13,
            y: 19,
            fits: ['autogun'],
          },
        ],
      ],
      points: [
        [-16, 0],
        [-4, 11],
        [-8, 26],
        [-16, 26],
      ],
    },
    {
      health: 8,
      points: [
        [-22, 26],
        [-24, 11],
        [-36, 8],
        [-38, 0],
        [-16, 0],
        [-16, 26],
      ],
    },
    {
      health: 50,
      core: true,
      points: [
        [-21, 0],
        [-16, -5],
        [-11, 0],
        [-16, 5],
      ],
    },
    {
      health: 50,
      core: true,
      mounts: [
        [
          {
            x: 0,
            y: 0,
            fits: ['shieldGeneratorSm', 'shieldGeneratorMd'],
          },
        ],
      ],
      points: [
        [-5, 0],
        [0, -5],
        [5, 0],
        [0, 5],
      ],
    },
  ],
} satisfies ShipSpec;
