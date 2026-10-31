import type { ShipSpec } from './types';

export const courser = {
  name: 'Courser',
  fuelCapacity: 120,
  cargoSpace: 8,
  drag: 0.56,
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
      mounts: [[{ x: 7.3, y: -8, fits: ['cannonSm'] }]],
      points: [
        [10, -25.5],
        [25, -9.5],
        [6, -9.5],
        [2, -12.5],
      ],
    },
    {
      health: 10,
      points: [
        [-9, -25.5],
        [10, -25.5],
        [2, -12.5],
        [-6, -12.5],
      ],
    },
    {
      health: 40,
      mounts: [
        [{ x: -19.8, y: 0, fits: ['thrusterSingleSm'] }],
        [{ x: -12.5, y: 0, fits: ['powerPlant'] }],
      ],
      points: [
        [-20, -7],
        [-9, -5],
        [-9, 5],
        [-20, 7],
      ],
    },
    {
      health: 30,
      core: true,
      mounts: [
        [{ x: 7.8, y: 0, fits: ['cargoHatchPair'] }],
        [{ x: -1, y: 0, fits: ['shieldGeneratorXs'] }],
      ],
      points: [
        [-9, -5],
        [-6, -12.5],
        [2, -12.5],
        [6, -9.5],
        [6, 9.5],
        [2, 12.5],
        [-6, 12.5],
        [-9, 5],
      ],
    },
    {
      health: 20,
      mounts: [[{ x: 7.3, y: 8, fits: ['cannonSm'] }]],
      points: [
        [2, 12.5],
        [6, 9.5],
        [25, 9.5],
        [10, 25.5],
      ],
    },
    {
      health: 10,
      points: [
        [-6, 12.5],
        [2, 12.5],
        [10, 25.5],
        [-9, 25.5],
      ],
    },
    {
      health: 12,
      points: [
        [-20, -7],
        [-9, -25.5],
        [-6, -12.5],
        [-9, -5],
      ],
    },
    {
      health: 12,
      points: [
        [-20, 7],
        [-9, 5],
        [-6, 12.5],
        [-9, 25.5],
      ],
    },
  ],
} satisfies ShipSpec;
