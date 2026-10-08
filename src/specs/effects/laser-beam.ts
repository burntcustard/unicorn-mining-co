import type { BeamEffectSpec } from '../../client/effects/beam-effect';
import { laserMuzzleFlash } from './laser-muzzle-flash';
import { laserHitMarker } from './laser-hit-marker';

export const laserBeam = {
  startFraction: 10 / 24,
  muzzleOffset: 1,
  pulseDuration: (Math.PI / 36) * 1000,
  pulseScale: 0.15,
  layers: [
    {
      lineWidth: 7,
      alpha: 0.12,
    },
    {
      lineWidth: 3,
      alpha: 0.5,
    },
    {
      lineWidth: 1,
      alpha: 1,
    },
  ],
  muzzleFlash: laserMuzzleFlash,
  hitMarker: laserHitMarker,
} as const satisfies BeamEffectSpec;
