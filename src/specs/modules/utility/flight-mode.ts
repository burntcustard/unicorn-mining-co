import { renderingLayers } from '../../rendering-layers';
import type { ModuleSpec } from '../types';

export const flightMode = {
  name: 'Flight Mode',
  icon: './flight-mode.svg',
  description:
    'Fold the wings for flight: 30% more acceleration, turning, and top speed. Toggle off for combat configuration.',
  behavior: 'flightMode',
  mass: 1,
  health: 25,
  price: 0,
  zIndex: renderingLayers.shipHull,
  activationDuration: 600,
  flightBoost: 0.3,
  disablePhysics: true,
  // The center hull already supplies the visible body. This part carries the
  // ordinary module activation state without covering its gold panels.
  model: [{ outline: false, points: [] as number[][], wreckage: false }],
} satisfies ModuleSpec;
