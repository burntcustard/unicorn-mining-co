import { colors } from '../colors';
import { powerPlantIdsBySize } from '../modules';
import type { HullSegmentSpecification, ShipSpec } from './types';

// Upright design coordinates: rightward X, rearward Y. Reflect each complete
// outline into the ship's forward-X coordinates.
const orient = ({ points, side }: { points: number[][]; side: number }) =>
  points.map(([x, y]) => [-y, side * x]);

// These are stroke centerlines, inset from the reviewed visible silhouette.
// Socket centerlines sit 5.4 from the gold: two 1.5 half-strokes + a 2.4 gap.
// The forward outer corner follows the yellow fitting's visible shoulder.
// Nine bow vertices spread the turning angle evenly along the outer arc.
// Three rear vertices soften the trailing sweep into four straight edges.
const whiteOutline = [
  [59.82, -5.44],
  [59.82, 5.44],
  [65.85, 15.89],
  [61.63, 22.65],
  [56.49, 29.43],
  [51.95, 34.25],
  [46.53, 39.1],
  [44.1, 39.1],
  [44.1, 12.99],
  [48.16, 10.64],
  [48.16, -21.59],
  [32.18, -30.82],
  [21.28, -57.15],
  [34.13, -49.53],
  [44.48, -43.02],
  [51.7, -37.68],
  [56.8, -32.72],
  [60.45, -28.12],
  [62.78, -23.92],
  [64.43, -19.84],
  [65.7, -15.62],
];

const whiteCollisionParts = [
  [0, 20, 19, 18, 17, 10],
  [2, 1, 7, 6, 5, 4, 3],
  [16, 15, 14, 13, 12, 11, 10, 17],
  [8, 7, 1, 9],
  [10, 9, 1, 0],
].map((indices) => indices.map((index) => whiteOutline[index]));

const innerGold = [
  [37, -2.45],
  [42.76, 0.87],
  [42.76, 7.53],
  [37, 10.85],
  [31.24, 7.53],
  [31.24, 0.87],
];
const outerGold = [
  [68.71, -10.03],
  [72.2, -3.99],
  [72.2, 3.99],
  [68.71, 10.03],
  [65.22, 3.99],
  [65.22, -3.99],
];

// A floating insert ahead of each inner fitting shares its 30-degree shoulders.
// Its outer flank aligns with the gold fitting beside one continuous white
// edge. Its slanted inner flank continues the straight bow edge at 22.5 degrees
// from forward, with the shared gap interrupting that line.
const foreVioletOutline = [
  [35.58, -22.62],
  [42.76, -18.48],
  [42.76, -10.7],
  [39.81, -12.4],
];

// Five straight sides: 45-degree inner shoulder, vertical inner flank,
// and two outer faces parallel to the neighboring reference-shaped flare.
const violetOutline = [
  [38.7, 40.69],
  [33.09, 43.93],
  [24.16, 74.53],
  [24.16, 36.72],
  [38.7, 22.18],
];
// Continue the outer stroke just around each corner so it joins at 90 degrees,
// separately from the radial seam. This avoids forked 45-degree miter tips.
// Half the hull stroke width keeps these real segments stable at small scales.
const cornerContinuation = 1.5;

export const crescent: ShipSpec = {
  name: 'Crescent',
  price: 0,
  fuelCapacity: 180,
  cargoSpace: 0,
  drag: 3896,
  // The built-in controller carries one unit of the original hull mass.
  hullMass: 6367,
  // Include the pointed tails after the wings slide backward in flight mode.
  radius: 94,
  angularThrust: 6958,
  turnRate: 2.2,
  initialLoadout: [
    { mount: 0, module: 'powerPlant2V' },
    { mount: 1, module: 'thrusterCrescent', shades: colors.violet },
    { mount: 2, module: 'thrusterCrescent', shades: colors.violet },
    { mount: 3, module: 'flightMode' },
  ],
  hullSegments: [
    {
      core: true,
      health: 100,
      shades: colors.yellow,
      lineJoin: 'miter',
      mounts: [[{ x: 0, y: 0, fits: powerPlantIdsBySize[2] }]],
      points: [
        [8, 0],
        [0, 8],
        [-8, 0],
        [0, -8],
      ],
    },
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 90,
      essential: true,
      connections: [side < 0 ? 3 : 4],
      shades: colors.white,
      lineJoin: 'miter',
      points: orient({ points: whiteOutline, side }),
      collisionParts: whiteCollisionParts.map((points) =>
        orient({ points, side }),
      ),
    })),
    ...[innerGold, outerGold].flatMap((points) =>
      [-1, 1].map((side): HullSegmentSpecification => ({
        health: 25,
        connections: [points === innerGold ? 0 : side < 0 ? 1 : 2],
        flightOffset: points === innerGold ? [-8, -side * 10] : undefined,
        shades: colors.yellow,
        lineJoin: 'miter',
        points: orient({ points, side }),
      })),
    ),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 20,
      connections: [side < 0 ? 1 : 2],
      shades: colors.violet,
      lineJoin: 'miter',
      points: orient({ points: violetOutline, side }),
      // The flare occupies the former small violet mount panel. No hull panel
      // sits beneath it; its cap shares the white shelf's horizontal direction.
      mounts: [
        [
          {
            x: -44,
            y: side * 44,
            fits: ['thrusterCrescent'],
          },
        ],
      ],
    })),
    ...[-1, 1].map((side): HullSegmentSpecification => ({
      health: 15,
      connections: [side < 0 ? 1 : 2],
      shades: colors.violet,
      lineJoin: 'miter',
      points: orient({ points: foreVioletOutline, side }),
    })),
    // Four real hull panels surround the central diamond. Exact shared edges
    // let the normal hull renderer light each face and the hull stay connected.
    ...[-1, 1].flatMap((side) =>
      [-1, 1].map((direction): HullSegmentSpecification => ({
        health: 25,
        connections: [0],
        // Keep the original three mount indexes; the controller shares the
        // power plant's central position on the final gold panel.
        ...(side === 1 && direction === 1
          ? { mounts: [[{ x: 0, y: 0, fits: ['flightMode'] }]] }
          : {}),
        shades: colors.yellow,
        lineJoin: 'miter',
        points: [
          [direction * 16, 0],
          [0, side * 16],
          [0, side * 8],
          [direction * 8, 0],
        ],
        shapeOutline: [
          [
            [direction * (16 - cornerContinuation), -side * cornerContinuation],
            [direction * 16, 0],
            [0, side * 16],
            [-direction * cornerContinuation, side * (16 - cornerContinuation)],
          ],
          [
            [direction * 16, 0],
            [direction * 8, 0],
            [0, side * 8],
            [0, side * 16],
          ],
        ],
      })),
    ),
  ],
};
