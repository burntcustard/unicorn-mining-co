import type { ShipDefinition } from './types';

export const mustang = {
  cargoSpace: 12,
  drag: 5 / 9,
  mass: 9,
  radius: 40,
  turnRate: 3,
  startingModules: [
    'thrusterDualMd',
    'cargoHatch',
    'cargoHatch',
    'hornDrill',
    'searchLight',
  ],
  startingCredits: 500,
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
      mounts: [{ fits: ['cargoHatch'], localPosition: { x: 3, y: -13 } }],
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
        {
          fits: [
            'thrusterDualMd',
            'thrusterSingle',
            'thrusterDualXl',
            'thrusterTriple',
          ],
          localPosition: { x: -16, y: 0 },
        },
        { fits: ['shieldGenerator'], localPosition: { x: 0, y: 0 } },
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
        { fits: ['hornDrill'], localPosition: { x: 20, y: 0 } },
        { fits: ['searchLight'], localPosition: { x: 20, y: 0 } },
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
      mounts: [{ fits: ['cargoHatch'], localPosition: { x: 3, y: 13 } }],
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
} satisfies ShipDefinition;
