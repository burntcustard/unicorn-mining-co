import { colors } from '../colors';

export const autogunMuzzleFlash = [
  {
    alpha: 0.3,
    color: colors.yellow[2],
    duration: 80,
    fadeDuration: 80,
    radius: 24,
    type: 'glow',
  },
  {
    color: colors.yellow[2],
    duration: 40,
    pointCount: 4,
    radius: 8,
    radiusEven: 4,
    spread: Math.PI,
    type: 'polygon',
  },
  {
    color: colors.white[2],
    duration: 20,
    pointCount: 4,
    radius: 4,
    radiusEven: 3,
    spread: Math.PI,
    type: 'polygon',
  },
] as const;
