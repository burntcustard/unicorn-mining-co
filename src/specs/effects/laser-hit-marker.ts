import type { BeamMarkerLayer } from '../../client/effects/beam-effect';

export const laserHitMarker = [
  {
    type: 'rays',
    radius: 6,
    radiusEven: 3.6,
    pointCount: 8,
    lineWidth: 1,
  },
  {
    type: 'glow',
    radius: 12,
    alpha: 0.6,
  },
] as const satisfies readonly BeamMarkerLayer[];
