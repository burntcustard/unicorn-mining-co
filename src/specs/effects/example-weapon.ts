import type { EffectSpec } from '../../client/effects/effect';
import type { BeamEffectSpec } from '../../client/effects/beam-effect';

export const exampleWeaponFlash = [
  { type: 'glow', color: '#ffffff', radius: 8, duration: 100 },
] satisfies EffectSpec;

export const exampleBeamEffect = {
  startFraction: 0.25,
  muzzleOffset: 2,
  pulseDuration: 80,
  pulseScale: 0.2,
  layers: [
    { lineWidth: 5, alpha: 0.2 },
    { lineWidth: 1, alpha: 1 },
  ],
  muzzleFlash: [
    { type: 'rays', radius: 3, radiusEven: 1, pointCount: 6, lineWidth: 2 },
    { type: 'glow', radius: 7, alpha: 0.6 },
  ],
  hitMarker: [
    { type: 'rays', radius: 5, radiusEven: 2, pointCount: 4, lineWidth: 1 },
    { type: 'glow', radius: 10, alpha: 0.6 },
  ],
} satisfies BeamEffectSpec;
