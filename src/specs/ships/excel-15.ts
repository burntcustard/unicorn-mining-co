import { powerPlantIdsBySize } from '../modules';
import type { HullSegmentSpecification, ShipSpec } from './types';

// Hull points on the positive-y side, plus points on the centerline.
const rearHullInnerCorner = [-51, 8];
const rearHullOuterCorner = [-51, 18];
const rearHullChamfer = [-48, 21];
const thrusterBayRear = [-39, 7];
const cockpitRear = [-20, 7];
const cockpitShoulder = [-4, 8];
const wingTrailingRoot = [-42, 22];
const wingRoot = [-22, 22];
const wingShoulder = [-4, 14];
const wingTrailingTip = [-21, 42];
const wingLeadingTip = [0.3, 42];
const noseBase = [24, 4];
const cockpitTip = [27, 0];
const noseShoulder = [8, 12];
const noseTaperStart = [34, noseShoulder[1]];
const noseRailEnd = [55, noseBase[1]];
const noseRailCenter = [noseRailEnd[0], 0];
const tipEnd = [73, 4];
const railExitX = 65;
const noseRailExit = [
  railExitX,
  noseTaperStart[1] +
    ((tipEnd[1] - noseTaperStart[1]) * (railExitX - noseTaperStart[0])) /
      (tipEnd[0] - noseTaperStart[0]),
];
const rearNoseCollisionPart = [
  noseBase,
  noseRailEnd,
  noseRailCenter,
  cockpitTip,
];

export const excel15 = {
  name: 'Excel-15',
  price: 3600,
  fuelCapacity: 145,
  cargoSpace: 14,
  drag: 1750,
  hullMass: 2800,
  radius: 72,
  angularThrust: 3800,
  turnRate: 2,
  initialLoadout: [
    { mount: 0, module: 'thrusterDualMd' },
    { mount: 1, module: 'powerPlant2V' },
    { mount: 3, module: 'cargoHatch' },
    { mount: 6, module: 'cargoHatch' },
  ],
  hullSegments: [
    {
      health: 50,
      points: [
        ...[thrusterBayRear, cockpitRear].map(([x, y]) => [x, -y]),
        cockpitRear,
        thrusterBayRear,
      ],
      mounts: [
        [
          {
            x: -51,
            y: 0,
            thrusterOffset: 3,
            fits: ['thrusterDualMd', 'thrusterDualLg'],
          },
        ],
        [
          {
            x: -28,
            y: 0,
            fits: [...powerPlantIdsBySize[2], ...powerPlantIdsBySize[3]],
          },
        ],
      ],
    },
    {
      health: 50,
      core: true,
      points: [
        ...[cockpitRear, cockpitShoulder, noseBase].map(([x, y]) => [x, -y]),
        cockpitTip,
        noseBase,
        cockpitShoulder,
        cockpitRear,
      ],
      mounts: [[{ x: 28, y: 0, fits: ['searchLight'] }]],
    },
    {
      health: 35,
      points: [
        ...[noseBase, noseRailEnd, noseRailExit, tipEnd].map(([x, y]) => [
          x,
          -y,
        ]),
        tipEnd,
        noseRailExit,
        noseRailEnd,
        noseBase,
        cockpitTip,
      ],
      collisionParts: [
        rearNoseCollisionPart,
        rearNoseCollisionPart.map(([x, y]) => [x, -y]),
        [
          ...[noseRailEnd, noseRailExit, tipEnd].map(([x, y]) => [x, -y]),
          tipEnd,
          noseRailExit,
          noseRailEnd,
        ],
      ],
    },
    ...[-1, 1].flatMap((side): HullSegmentSpecification[] => [
      {
        health: 49,
        points: [
          noseBase,
          cockpitShoulder,
          wingShoulder,
          noseShoulder,
          noseTaperStart,
          noseRailExit,
          noseRailEnd,
        ].map(([x, y]) => [x, side * y]),
        collisionParts: [
          [noseBase, cockpitShoulder, wingShoulder, noseShoulder].map(
            ([x, y]) => [x, side * y],
          ),
          [
            noseBase,
            noseShoulder,
            noseTaperStart,
            noseRailExit,
            noseRailEnd,
          ].map(([x, y]) => [x, side * y]),
        ],
        mounts: [
          [
            {
              x: 34,
              y: side * 10,
              cargoPickupOffset: 0,
              fits: ['cargoHatch'],
            },
          ],
        ],
      },
      {
        health: 70,
        points: [
          rearHullInnerCorner,
          thrusterBayRear,
          cockpitRear,
          wingRoot,
          wingTrailingRoot,
          rearHullChamfer,
          rearHullOuterCorner,
        ].map(([x, y]) => [x, side * y]),
        mounts: [[{ x: -35, y: side * 14.5, fits: ['thrustBooster'] }]],
      },
      {
        health: 120,
        points: [
          cockpitRear,
          cockpitShoulder,
          wingShoulder,
          wingLeadingTip,
          wingTrailingTip,
          wingTrailingRoot,
          wingRoot,
        ].map(([x, y]) => [x, side * y]),
        mounts: [
          [
            {
              x: -12,
              y: side * 33,
              fits: ['autogun', 'plasmaAccelerator', 'laser'],
            },
          ],
        ],
      },
    ]),
  ],
} satisfies ShipSpec;
