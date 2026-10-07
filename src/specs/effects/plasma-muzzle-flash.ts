import { colors } from '../colors';

export const plasmaMuzzleFlash = [
  {
    alpha: 0.3,
    color: colors.violet[2],
    duration: 120,
    fadeDuration: 120,
    radius: 30,
    type: 'glow',
  },
  {
    color: colors.violet[2],
    duration: 40,
    pointCount: 4,
    radius: 10,
    radiusEven: 5,
    spread: Math.PI,
    type: 'polygon',
  },
  {
    color: colors.white[2],
    duration: 20,
    pointCount: 4,
    radius: 5,
    radiusEven: 3,
    spread: Math.PI,
    type: 'polygon',
  },
] as const;
