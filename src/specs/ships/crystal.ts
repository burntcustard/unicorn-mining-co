import { colors } from '../colors';
import type { ShipSpec, HullSegmentSpecification } from './types';

const junction = [104, 0];

const yellowPanel = (side: number) => [
  [-11.25, side * 40],
  [-14.5, side * 36],
  [-21, side * 36],
  [-16, side * 39.5],
];

// A swept leading edge seats the insert along the outside of each upright fin.
const sidePanel = (side: number) => [
  [1, side * 40],
  [-5, side * 40],
  [-12, side * 31],
  [-28, side * 31],
  [-37, side * 24],
  [-11, side * 24],
];

const panelHitboxes = [
  [
    [1, 42],
    [-3, 42],
    [-8, 31.5],
    [-11, 24],
  ],
  [
    [-11, 24],
    [-8, 31.5],
    [-28, 31.5],
    [-37, 24],
  ],
];

const sideCrystals = [-1, 1].map((side) => {
  const center = [15.5, side * 29];
  const angle = Math.atan2(junction[1] - center[1], junction[0] - center[0]);

  return [
    [10.5, 0],
    [0, 3.5],
    [-10.5, 0],
    [0, -3.5],
  ].map(([x, y]) => [
    center[0] + x * Math.cos(angle) - y * Math.sin(angle),
    center[1] + x * Math.sin(angle) + y * Math.cos(angle),
  ]);
});

export const crystal: ShipSpec = {
  name: 'Crystal',
  npcOnly: true,
  fuelCapacity: 140,
  cargoSpace: 0,
  drag: 0.56,
  mass: 14,
  radius: 70,
  turnRate: 1.9,
  crystalWeapon: {
    emitters: [
      { hullIndex: 1, position: [52, 0] },
      ...sideCrystals.map((points, index) => ({
        hullIndex: index + 2,
        position: points[0],
      })),
    ],
    junction,
    damage: 0.8,
    reach: 800,
    powerFiring: 4.2,
  },
  initialLoadout: [
    { mount: 0, module: 'powerPlant' },
    { mount: 1, module: 'thrusterSingleSm', shades: colors.violet },
  ],
  hullSegments: [
    {
      core: true,
      connections: [],
      health: 110,
      shades: colors.white,
      mounts: [
        [{ x: -14, y: 0, fits: ['powerPlant'] }],
        [{ x: -36, y: 0, fits: ['thrusterSingleSm'] }],
      ],
      points: [
        [11, -13],
        [1, -17],
        [-13, -17],
        [-23, -7],
        [-33, -5],
        [-33, 5],
        [-23, 7],
        [-13, 17],
        [1, 17],
        [11, 13],
        [5, 9],
        [-5, 9],
        [-12, 0],
        [-5, -9],
        [5, -9],
      ],
    },
    {
      health: 85,
      lineJoin: 'miter',
      connections: [0],
      shades: colors.violet,
      color: '#e8a0f4',
      points: [
        [52, 0],
        [39, 12],
        [14, 12],
        [1, 0],
        [14, -12],
        [39, -12],
      ],
      decorations: [-1, 1].flatMap((side) => [
        {
          color: '#cc7cde',
          points: [
            [14, side * 12],
            [39, side * 12],
            [36, side * 7],
            [17, side * 7],
          ],
        },
        {
          color: '#f3bcff',
          points: [
            [52, 0],
            [39, side * 12],
            [36, side * 7],
            [45, 0],
          ],
        },
        {
          color: '#f3bcff',
          points: [
            [1, 0],
            [14, side * 12],
            [17, side * 7],
            [8, 0],
          ],
        },
      ]),
    },
    ...sideCrystals.map((points): HullSegmentSpecification => ({
      health: 30,
      lineJoin: 'miter',
      connections: [0],
      shades: colors.violet,
      points,
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => {
      const outer = sidePanel(side);

      return {
        health: 65,
        lineJoin: 'miter',
        connections: [0],
        shades: colors.white,
        points: outer,
        collisionParts: panelHitboxes.map((outline) =>
          outline.map(([x, y]) => [x, side * y]),
        ),
      };
    }),
    ...[-1, 1].map((side, index): HullSegmentSpecification => ({
      health: 20,
      lineJoin: 'miter',
      connections: [index + 4],
      shades: colors.yellow,
      points: yellowPanel(side),
    })),
  ],
};
