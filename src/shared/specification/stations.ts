import { colors } from '../colors';
import { stationGeometry } from '../craft/stations/corral-geometry';

export const stationSpecifications = {
  corral: {
    localMovementRadius: 600,
    mass: 1e9,
    zIndex: 2,
    bayFillAlpha: 4,
    bayFloorZIndex: -3,
    bayCeilingZIndex: 3,
    bayGlowShades: colors.green,
    geometry: stationGeometry,
  },
} as const satisfies Record<
  'corral',
  {
    localMovementRadius: number;
    mass: number;
    zIndex: number;
    bayFillAlpha: number;
    bayFloorZIndex: number;
    bayCeilingZIndex: number;
    bayGlowShades: readonly string[];
    geometry: typeof stationGeometry;
  }
>;
