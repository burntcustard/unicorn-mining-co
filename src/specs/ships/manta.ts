import { colors } from '../colors';
import type { ShipSpec, HullSegmentSpecification } from './types';

const cyanWing = (side: number) => [
  [16, side * 13],
  [8, side * 26, 12, side * 18, 6, side * 22],
  [9, side * 34, 10, side * 29, 11, side * 31],
  [-2.1, side * 58, 7, side * 43, 0, side * 51],
  [-6, side * 48],
  [4, side * 33, -3, side * 40, 6, side * 39],
  [3, side * 25, 5, side * 30, 1, side * 29],
  [11, side * 13, 4, side * 21, 8, side * 17],
  [16, side * 13],
];

// Coarse convex fixtures surround each inset without a mesh of curve samples.
const wingHitboxes = [
  [
    [24, 8],
    [10, 57],
    [5.4, 58],
    [18.5, 13],
  ],
  [
    [-16, 8],
    [24, 8],
    [18.5, 13],
    [8.5, 13],
  ],
  [
    [5.4, 58],
    [10, 57],
    [-18, 73],
  ],
  [
    [-4.6, 58],
    [5.4, 58],
    [-18, 73],
  ],
  [
    [-4.6, 58],
    [-18, 73],
    [-5, 48],
  ],
  [
    [8.5, 13],
    [-4.6, 58],
    [-5, 48],
  ],
  [
    [-16, 8],
    [8.5, 13],
    [-5, 48],
    [-16, 22],
  ],
];
const cyanHitbox = [
  [18.5, 13],
  [5.4, 58],
  [-4.6, 58],
  [8.5, 13],
];

export const manta: ShipSpec = {
  name: 'Manta',
  npcOnly: true,
  fuelCapacity: 160,
  cargoSpace: 0,
  drag: 0.56,
  mass: 12,
  radius: 110,
  turnRate: 2.8,
  initialLoadout: [
    { mount: 0, module: 'powerPlant' },
    { mount: 1, module: 'thrusterSingleSm', shades: colors.yellow },
    { mount: 2, module: 'thrusterSingleSm', shades: colors.yellow },
  ],
  hullSegments: [
    {
      core: true,
      health: 90,
      shades: colors.white,
      mounts: [[{ x: 12, y: 0, fits: ['powerPlant'] }]],
      points: [
        [35, 0],
        [24, -8],
        [6, -8],
        [-2, 0],
        [6, 8],
        [24, 8],
      ],
      collisionParts: [
        [
          [35, 0],
          [24, -8],
          [6, -8],
          [-2, 0],
          [6, 8],
          [24, 8],
        ],
      ],
      curvePoints: [
        [35, 0],
        [24, -8, 29, -5],
        [6, -8, 14, -10],
        [-2, 0, 1, -5],
        [6, 8, 1, 5],
        [24, 8, 14, 10],
        [35, 0, 29, 5],
      ],
    },
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 100,
      connections: [0],
      shades: colors.white,
      // This is the wing's only straight edge; the flare projects backward.
      mounts: [[{ x: -16, y: side * 15, fits: ['thrusterSingleSm'] }]],
      points: [
        [24, side * 8],
        [-18, side * 73],
        [-16, side * 22],
        [-16, side * 8],
        [-10, side * 5],
        [0, 0],
        [6, side * 7],
      ],
      curvePoints: [
        [24, side * 8],
        [-18, side * 73, 2, side * 26, 36, side * 52],
        [-16, side * 22, -2, side * 65, 1, side * 36],
        [-16, side * 8],
        [-10, side * 5, -13, side * 6],
        [0, 0, -4, side * 5],
        [6, side * 7, 3, side * 4],
        [24, side * 8, 14, side * 9],
      ],
      cutouts: [cyanWing(side)],
      collisionParts: wingHitboxes.map((outline) =>
        outline.map(([x, y]) => [x, side * y]),
      ),
    })),
    {
      health: 55,
      connections: [0],
      shades: colors.white,
      animation: { pivot: [0, 0], amplitude: 0.09, phase: 0 },
      points: [
        [2, 0],
        [-10, -6],
        [-27, 0],
        [-10, 6],
      ],
      collisionParts: [
        [
          [2, 0],
          [-10, -6],
          [-27, 0],
          [-10, 6],
        ],
      ],
      curvePoints: [
        [2, 0],
        [-10, -6, -3, -6],
        [-27, 0, -24, -8],
        [-10, 6, -24, 8],
        [2, 0, -3, 6],
      ],
    },
    ...[2.4, 1.5, 0.6].map((halfWidth, index): HullSegmentSpecification => ({
      health: 22,
      ribbon: true,
      connections: [index + 3],
      shades: colors.white,
      animation: {
        pivot: [-26 - index * 16, 0],
        amplitude: 0.22 + index * 0.08,
        phase: -0.7 - index * 0.65,
        parent: index + 3,
      },
      points: [
        [-26 - index * 16, -halfWidth],
        [-42 - index * 16, -halfWidth],
        [-42 - index * 16, halfWidth],
        [-26 - index * 16, halfWidth],
      ],
      // The rectangles are hidden collision geometry for the continuous ribbon.
      collisionParts: [
        [
          [-26 - index * 16, -halfWidth],
          [-42 - index * 16, -halfWidth],
          [-42 - index * 16, halfWidth],
          [-26 - index * 16, halfWidth],
        ],
      ],
    })),
    {
      health: 25,
      connections: [6],
      shades: colors.cyan,
      animation: { pivot: [-74, 0], amplitude: 0.1, phase: -2.8, parent: 6 },
      points: [
        [-74, 0],
        [-79, -3.5],
        [-93, 0],
        [-79, 3.5],
      ],
    },
    ...[-1, 1].map((side, index): HullSegmentSpecification => ({
      health: 25,
      connections: [index + 1],
      shades: colors.cyan,
      points: cyanWing(side)
        .slice(0, -1)
        .map((point) => point.slice(0, 2)),
      curvePoints: cyanWing(side),
      collisionParts: [cyanHitbox.map(([x, y]) => [x, side * y])],
    })),
  ],
};
