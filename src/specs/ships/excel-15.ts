import { powerPlantIdsBySize } from '../modules';
import type { HullSegmentSpecification, ShipSpec } from './types';

const centeredOutline = (edge: number[][], tip?: number[]) => [
  ...edge.map(([x, y]) => [x, -y]),
  ...(tip ? [tip] : []),
  ...edge.slice().reverse(),
];

const cockpitRearEdge = [
  [-20, 7],
  [-4, 8],
];
const noseBase = [24, 4];
const cockpitTip = [27, 0];
const noseShoulder = [8, 12];
const noseTaperStart = [34, noseShoulder[1]];
const noseRailEnd = [55, noseBase[1]];
const rearNoseCollisionPart = [
  noseBase,
  noseRailEnd,
  [noseRailEnd[0], 0],
  cockpitTip,
];
const tipEnd = [73, 4];
const railExitX = 65;
const noseRailExit = [
  railExitX,
  noseTaperStart[1] +
    ((tipEnd[1] - noseTaperStart[1]) * (railExitX - noseTaperStart[0])) /
      (tipEnd[0] - noseTaperStart[0]),
];
const wingShoulder = [-4, 14];

export const excel15 = {
  name: 'Excel-15',
  price: 3600,
  fuelCapacity: 145,
  cargoSpace: 8,
  drag: 1750,
  hullMass: 2800,
  radius: 72,
  angularThrust: 4600,
  turnRate: 2,
  initialLoadout: [
    { mount: 0, module: 'thrusterDualMd' },
    { mount: 1, module: 'powerPlant2V' },
    { mount: 2, module: 'searchLight' },
    { mount: 3, module: 'cargoHatch' },
    { mount: 4, module: 'thrustBooster' },
    { mount: 5, module: 'autogun' },
    { mount: 6, module: 'cargoHatch' },
    { mount: 7, module: 'thrustBooster' },
    { mount: 8, module: 'autogun' },
  ],
  hullSegments: [
    {
      health: 50,
      points: [
        [-39, -7],
        [-20, -7],
        [-20, 7],
        [-39, 7],
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
      points: centeredOutline([...cockpitRearEdge, noseBase], cockpitTip),
      mounts: [[{ x: 28, y: 0, fits: ['searchLight'] }]],
    },
    {
      health: 35,
      points: [
        ...centeredOutline([noseBase, noseRailEnd, noseRailExit, tipEnd]),
        cockpitTip,
      ],
      collisionParts: [
        rearNoseCollisionPart,
        rearNoseCollisionPart.map(([x, y]) => [x, -y]),
        centeredOutline([noseRailEnd, noseRailExit, tipEnd]),
      ],
    },
    ...[-1, 1].flatMap((side): HullSegmentSpecification[] => {
      const reflect = (points: number[][]) =>
        points.map(([x, y]) => [x, side * y]);

      const wingRoot = [-22, 20];
      const wingTrailingRoot = [-42, 21];
      const wingInnerEdge = [
        [-20, 7],
        [-4, 8],
      ];
      const outerWing = [
        wingShoulder,
        [0.3, 42],
        [-21, 42],
        wingTrailingRoot,
        wingRoot,
      ];

      return [
        {
          health: 49,
          points: reflect([
            noseBase,
            cockpitRearEdge[1],
            wingShoulder,
            noseShoulder,
            noseTaperStart,
            noseRailExit,
            noseRailEnd,
          ]),
          collisionParts: [
            reflect([noseBase, cockpitRearEdge[1], wingShoulder, noseShoulder]),
            reflect([
              noseBase,
              noseShoulder,
              noseTaperStart,
              noseRailExit,
              noseRailEnd,
            ]),
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
          points: reflect([
            [-51, 8],
            [-39, 7],
            [-20, 7],
            wingRoot,
            wingTrailingRoot,
            [-48, 21],
            [-51, 18],
          ]),
          mounts: [[{ x: -33, y: side * 14, fits: ['thrustBooster'] }]],
        },
        {
          health: 120,
          points: reflect([...wingInnerEdge, ...outerWing]),
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
      ];
    }),
  ],
} satisfies ShipSpec;
