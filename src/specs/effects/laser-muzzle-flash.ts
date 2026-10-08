import type { BeamMarkerLayer } from '../../client/effects/beam-effect';

export const laserMuzzleFlash = [
  {
    type: 'rays',
    radius: 4,
    radiusEven: 3,
    pointCount: 8,
    lineWidth: 1,
  },
  {
    type: 'glow',
    radius: 8,
    alpha: 0.5,
  },
] as const satisfies readonly BeamMarkerLayer[];
