import type { ShipSpec } from './types';

export const courser = {
  name: 'Courser',
  fuelCapacity: 120,
  cargoSpace: 8,
  drag: 5 / 9,
  mass: 9,
  radius: 40,
  turnRate: 3,
  initialLoadout: [
    { mount: 0, module: 'cannonSm' },
    { mount: 1, module: 'thrusterSingleSm' },
    { mount: 2, module: 'powerPlant' },
    { mount: 3, module: 'cargoHatchPair' },
    { mount: 5, module: 'cannonSm' },
  ],
  hullSegments: [
    {
      health: 20,
      mounts: [[{ x: 3.3, y: -8, fits: ['cannonSm'] }]],
      points: [
        [6, -25.5],
        [21, -9.5],
        [2, -9.5],
        [-2, -12.5],
      ],
    },
    {
      health: 10,
      points: [
        [-13, -25.5],
        [6, -25.5],
        [-2, -12.5],
        [-10, -12.5],
      ],
    },
    {
      health: 50,
      mounts: [
        [{ x: -23.8, y: 0, fits: ['thrusterSingleSm'] }],
        [{ x: -16.5, y: 0, fits: ['powerPlant'] }],
      ],
      points: [
        [-24, -7],
        [-13, -5],
        [-13, 5],
        [-24, 7],
      ],
    },
    {
      health: 40,
      core: true,
      mounts: [
        [{ x: 3.8, y: 0, fits: ['cargoHatchPair'] }],
        [{ x: -5, y: 0, fits: ['shieldGeneratorXs'] }],
      ],
      points: [
        [-13, -5],
        [-10, -12.5],
        [-2, -12.5],
        [2, -9.5],
        [2, 9.5],
        [-2, 12.5],
        [-10, 12.5],
        [-13, 5],
      ],
    },
    {
      health: 20,
      mounts: [[{ x: 3.3, y: 8, fits: ['cannonSm'] }]],
      points: [
        [-2, 12.5],
        [2, 9.5],
        [21, 9.5],
        [6, 25.5],
      ],
    },
    {
      health: 10,
      points: [
        [-10, 12.5],
        [-2, 12.5],
        [6, 25.5],
        [-13, 25.5],
      ],
    },
    {
      health: 10,
      points: [
        [-24, -7],
        [-13, -25.5],
        [-10, -12.5],
        [-13, -5],
      ],
    },
    {
      health: 10,
      points: [
        [-24, 7],
        [-13, 5],
        [-10, 12.5],
        [-13, 25.5],
      ],
    },
  ],
} satisfies ShipSpec;
