import { colors } from './colors';
import { renderingLayers } from './rendering-layers';

// Each antenna runs from the hull to the end of its illuminated tip.
export const navBeaconAntennae = [
  [-2.5, -17, -27],
  [2.5, -16, -35],
  [2.5, 17, 27],
  [-2.5, 16, 35],
];

const antennaSegment = ([x, start, end]: number[], tip: boolean) => {
  const join = end - Math.sign(end) * 3;
  const from = tip ? join : start;
  const to = tip ? end : join;

  return {
    health: 100,
    zIndex: renderingLayers.modulesBelowShipHull,
    shades: tip ? colors.violet : colors.gray,
    points: [
      [x - 1.5, from],
      [x + 1.5, from],
      [x + 1.5, to],
      [x - 1.5, to],
    ],
  };
};

// The narrow middle and rounded ends form a single symmetric silhouette.
export const navBeaconSpec = {
  name: 'Nav Beacon',
  mass: 10000,
  radius: 36,
  hullSegments: [
    {
      health: 200,
      core: true,
      points: [
        [-9.25, -5.5],
        [9.25, -5.5],
        [9.25, 5.5],
        [-9.25, 5.5],
      ],
    },
    {
      health: 100,
      points: [
        [-11, -5.5],
        [-11, -10],
        [-9.5, -13.25],
        [-6.5, -16],
        [-3, -17.25],
        [3, -17.25],
        [6.5, -16],
        [9.5, -13.25],
        [11, -10],
        [11, -5.5],
      ],
    },
    {
      health: 100,
      points: [
        [11, 5.5],
        [11, 10],
        [9.5, 13.25],
        [6.5, 16],
        [3, 17.25],
        [-3, 17.25],
        [-6.5, 16],
        [-9.5, 13.25],
        [-11, 10],
        [-11, 5.5],
      ],
    },
    {
      health: 200,
      disablePhysics: true,
      shades: colors.violet,
      points: Array.from({ length: 16 }, (_, i) => [
        Math.cos((i * Math.PI) / 8) * 3.75,
        Math.sin((i * Math.PI) / 8) * 3.75,
      ]),
    },
    ...navBeaconAntennae.map((antenna) => antennaSegment(antenna, false)),
    ...navBeaconAntennae.map((antenna) => antennaSegment(antenna, true)),
  ],
};
