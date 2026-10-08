import type { ShipSpec } from './types';

export const arrow = {
  name: 'Arrow',
  cargoSpace: 12,
  drag: 5 / 9,
  mass: 9,
  radius: 40,
  turnRate: 3,
  initialLoadout: [
    { mount: 2, module: 'thrusterSingleMd' },
    { mount: 0, module: 'cargoHatch' },
    { mount: 4, module: 'cargoHatch' },
  ],
  hullSegments: [
    {
      health: 8,
      points: [
        [-32, -17],
        [-18, -28],
        [-18, -10],
        [-32, -10],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: -9,
            y: -24,
            fits: ['cargoHatch'],
          },
          {
            x: -12,
            y: -24,
            fits: ['plasmaAccelerator', 'autogun', 'laser'],
          },
        ],
        [
          {
            x: 13,
            y: -14,
            fits: ['cargoHatch'],
          },
          {
            x: 8.5,
            y: -15,
            fits: ['plasmaAccelerator', 'autogun', 'laser'],
          },
        ],
      ],
      points: [
        [-18, -28],
        [30, -7],
        [26, 0],
        [10, 0],
        [-18, -10],
      ],
    },
    {
      health: 50,
      core: true,
      mounts: [
        [
          {
            x: -32,
            y: 0,
            fits: ['thrusterSingleSm', 'thrusterSingleMd'],
          },
        ],
        [
          {
            x: 0,
            y: 0,
            fits: ['shieldGeneratorMd'],
          },
        ],
      ],
      points: [
        [-32, -10],
        [-18, -10],
        [10, 0],
        [-18, 10],
        [-32, 10],
      ],
    },
    {
      health: 20,
      mounts: [
        [
          {
            x: -9,
            y: 24,
            fits: ['cargoHatch'],
          },
          {
            x: -12,
            y: 24,
            fits: ['plasmaAccelerator', 'autogun', 'laser'],
          },
        ],
        [
          {
            x: 13,
            y: 14,
            fits: ['cargoHatch'],
          },
          {
            x: 8.5,
            y: 15,
            fits: ['plasmaAccelerator', 'autogun', 'laser'],
          },
        ],
      ],
      points: [
        [-18, 10],
        [10, 0],
        [26, 0],
        [30, 7],
        [-18, 28],
      ],
    },
    {
      health: 8,
      points: [
        [-32, 10],
        [-18, 10],
        [-18, 28],
        [-32, 17],
      ],
    },
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
            fits: ['autogun', 'laser'],
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
        [23, 0],
      ],
    },
  ],
} satisfies ShipSpec;
