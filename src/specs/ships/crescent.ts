import { colors } from '../colors';
import type { ShipSpec, HullSegmentSpecification } from './types';

const crystalRise = Math.sqrt(3) * 2.5;
const socketRise = crystalRise + 3;
const socketRadius = 5 + Math.sqrt(3) * 2;
const socketHalf = socketRadius / 2;
const innerCrystalY = 22;
const socketMouth = socketRadius - (26 - innerCrystalY) / Math.sqrt(3);

const wingOutline = (side: number) => [
  [37, side * 12],
  [9.75, side * 44, 30, side * 40],
  [4.5, side * 38],
  [-4.5, side * 38],
  [-9.75, side * 44],
  [-26, side * 26],
  [-3 - socketMouth, side * 26],
  [-3 - socketHalf, side * (innerCrystalY + socketRise)],
  [-3 + socketHalf, side * (innerCrystalY + socketRise)],
  [-3 + socketMouth, side * 26],
  [10, side * 26],
  [37, side * 12, 25, side * 18],
];

const wingHitboxes = [
  [
    [25, 19],
    [37, 12],
    [27, 34],
    [9.75, 44],
    [4.5, 38],
  ],
  [
    [25, 19],
    [4.5, 38],
    [-4.5, 38],
    [10, 26],
  ],
  [
    [-4.5, 38],
    [-9.75, 44],
    [-26, 26],
    [-3 - socketMouth, 26],
    [-3 - socketHalf, innerCrystalY + socketRise],
  ],
  [
    [-4.5, 38],
    [-3 - socketHalf, innerCrystalY + socketRise],
    [-3 + socketHalf, innerCrystalY + socketRise],
  ],
  [
    [-3 + socketHalf, innerCrystalY + socketRise],
    [-3 + socketMouth, 26],
    [10, 26],
  ],
  [
    [-4.5, 38],
    [-3 + socketHalf, innerCrystalY + socketRise],
    [10, 26],
  ],
];

export const crescent: ShipSpec = {
  name: 'Crescent',
  npcOnly: true,
  fuelCapacity: 180,
  cargoSpace: 0,
  drag: 0.56,
  mass: 15,
  radius: 72,
  turnRate: 2.2,
  initialLoadout: [
    { mount: 0, module: 'powerPlant' },
    { mount: 1, module: 'thrusterSingleSm', shades: colors.violet },
    { mount: 2, module: 'thrusterSingleSm', shades: colors.violet },
  ],
  hullSegments: [
    {
      core: true,
      health: 100,
      shades: colors.yellow,
      mounts: [[{ x: 0, y: 0, fits: ['powerPlant'] }]],
      points: [
        [12, 0],
        [0, 11],
        [-12, 0],
        [0, -11],
      ],
      decorations: [-1, 1].flatMap((side) => [
        {
          color: colors.yellow[2],
          points: [
            [12, 0],
            [0, side * 11],
            [0, side * 5.5],
            [6, 0],
          ],
        },
        {
          color: colors.yellow[0],
          points: [
            [-12, 0],
            [0, side * 11],
            [0, side * 5.5],
            [-6, 0],
          ],
        },
      ]),
    },
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 90,
      essential: true,
      connections: [0],
      shades: colors.white,
      // Socket lips allow for the outlines, as station docking-bay cutouts do.
      points: wingOutline(side)
        .slice(0, -1)
        .map((point) => point.slice(0, 2)),
      curvePoints: wingOutline(side),
      collisionParts: wingHitboxes.map((outline) =>
        outline.map(([x, y]) => [x, side * y]),
      ),
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 25,
      connections: [0],
      shades: colors.yellow,
      points: [
        [2, side * innerCrystalY],
        [-0.5, side * (innerCrystalY + crystalRise)],
        [-5.5, side * (innerCrystalY + crystalRise)],
        [-8, side * innerCrystalY],
        [-5.5, side * (innerCrystalY - crystalRise)],
        [-0.5, side * (innerCrystalY - crystalRise)],
      ],
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 15,
      connections: [0],
      shades: colors.yellow,
      points: [
        [3, side * 47],
        [8, side * 44],
        [3, side * 41],
        [-3, side * 41],
        [-8, side * 44],
        [-3, side * 47],
      ],
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 20,
      connections: [0],
      shades: colors.violet,
      points: [
        [-10, side * 26],
        [-26, side * 13],
        [-48, side * 12],
        [-38, side * 18],
        [-28, side * 21],
        [-26, side * 28],
      ],
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 15,
      connections: [0],
      shades: colors.violet,
      mounts: [[{ x: -36, y: side * 24, fits: ['thrusterSingleSm'] }]],
      points: [
        [-27, side * 28],
        [-30, side * 21],
        [-39, side * 18],
        [-35, side * 27],
      ],
    })),
  ],
};
