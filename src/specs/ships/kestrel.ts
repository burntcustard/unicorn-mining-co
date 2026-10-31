import type { ShipSpec } from './types';

const rearX = -28.4;
const frontX = 28.8;
const tipX = -2;
const tipY = 63.8;
const rearCornerX = -19.6;
const rearCornerY = 57.2;
// The tip divider meets the side of the forward diagonal, not the core corner.
const junctionX = 9 + (frontX - 9) * 0.34;
const junctionY = 16.5 + (33 - 16.5) * 0.34;

export const kestrel = {
  name: 'Kestrel',
  fuelCapacity: 155,
  cargoSpace: 18,
  drag: 0.42,
  mass: 12,
  radius: 73,
  turnRate: 2.6,
  initialLoadout: [
    {
      mount: 0,
      module: 'shieldGeneratorLg',
    },
    {
      mount: 1,
      module: 'powerPlant',
    },
    {
      mount: 2,
      module: 'thrusterDualLg',
    },
    {
      mount: 3,
      module: 'hornDrill',
    },
    {
      mount: 4,
      module: 'searchLight',
    },
    {
      mount: 5,
      module: 'cargoHatch',
    },
    {
      mount: 6,
      module: 'autogunTurret',
    },
    {
      mount: 7,
      module: 'hornDrill',
    },
    {
      mount: 8,
      module: 'searchLight',
    },
    {
      mount: 9,
      module: 'cargoHatch',
    },
    {
      mount: 10,
      module: 'autogunTurret',
    },
  ],
  hullSegments: [
    {
      health: 50,
      core: true,
      points: [
        [-9, -16.5],
        [9, -16.5],
        [9, 16.5],
        [-9, 16.5],
      ],
      mounts: [
        [
          {
            x: 0,
            y: 0,
            fits: ['shieldGeneratorLg'],
          },
        ],
        [
          {
            x: -8.6,
            y: 0,
            fits: ['powerPlant'],
          },
        ],
      ],
    },
    {
      health: 35,
      points: [
        [rearX, -16.5],
        [-9, -16.5],
        [-9, 16.5],
        [rearX, 16.5],
      ],
      mounts: [
        [
          {
            // Let the flare overlap the rear hull by just one unit.
            x: rearX + 1,
            y: 0,
            fits: ['thrusterDualLg'],
          },
        ],
      ],
    },
    {
      health: 30,
      points: [
        [frontX, -33],
        [frontX, 0],
        [9, 0],
        [9, -16.5],
        [junctionX, -junctionY],
      ],
      mounts: [
        [
          {
            x: frontX,
            y: -14.8,
            fits: ['hornDrill', 'autogun', 'laser', 'plasmaAccelerator'],
          },
        ],
        [
          {
            x: frontX + 5,
            y: -14.8,
            fits: ['searchLight'],
          },
        ],
      ],
    },
    {
      health: 35,
      points: [
        [frontX, -33],
        [junctionX, -junctionY],
        [tipX, -tipY],
      ],
      mounts: [
        [
          {
            x: 11.8,
            y: -48,
            fits: ['cargoHatch'],
          },
        ],
      ],
    },
    {
      health: 30,
      points: [
        [tipX, -tipY],
        [junctionX, -junctionY],
        [9, -16.5],
        [-9, -16.5],
        [rearX, -16.5],
        [rearCornerX, -rearCornerY],
      ],
      mounts: [
        [
          {
            x: -10,
            y: -33,
            fits: ['autogunTurret', 'plasmaAcceleratorTurret', 'laserTurret'],
          },
        ],
      ],
    },
    {
      health: 30,
      points: [
        [9, 16.5],
        [9, 0],
        [frontX, 0],
        [frontX, 33],
        [junctionX, junctionY],
      ],
      mounts: [
        [
          {
            x: frontX,
            y: 14.8,
            fits: ['hornDrill', 'autogun', 'laser', 'plasmaAccelerator'],
          },
        ],
        [
          {
            x: frontX + 5,
            y: 14.8,
            fits: ['searchLight'],
          },
        ],
      ],
    },
    {
      health: 35,
      points: [
        [tipX, tipY],
        [junctionX, junctionY],
        [frontX, 33],
      ],
      mounts: [
        [
          {
            x: 11.8,
            y: 48,
            fits: ['cargoHatch'],
          },
        ],
      ],
    },
    {
      health: 30,
      points: [
        [rearCornerX, rearCornerY],
        [rearX, 16.5],
        [-9, 16.5],
        [9, 16.5],
        [junctionX, junctionY],
        [tipX, tipY],
      ],
      mounts: [
        [
          {
            x: -10,
            y: 33,
            fits: ['autogunTurret', 'plasmaAcceleratorTurret', 'laserTurret'],
          },
        ],
      ],
    },
  ],
} satisfies ShipSpec;
