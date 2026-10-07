import { colors } from '../colors';

export const autogunExplosion = [
  {
    alpha: 0.4,
    color: colors.yellow[2],
    duration: 310,
    easeOut: 310 / 130,
    fadeDuration: 230,
    radius: 26,
    scale: [0, 1],
    type: 'glow',
  },
  {
    color: colors.yellow[2],
    dissolveDuration: 190,
    duration: 210,
    easeOut: 210 / 90,
    fadeDuration: 80,
    pointCount: 7,
    radius: 13,
    radiusEven: [3.25, 9.75],
    scale: [0.15, 1],
    type: 'polygon',
  },
  {
    color: colors.yellow[2],
    duration: 70,
    easeOut: 2,
    fadeDuration: 20,
    pointCount: 7,
    radius: 8,
    radiusEven: [2, 6],
    scale: [1, 0],
    type: 'polygon',
  },
] as const;
