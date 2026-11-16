import type { ModuleSpec } from '../types';

export const flightMode = {
  name: 'Flight Mode',
  icon: './flight-mode.svg',
  description:
    'Fold the wings for flight: 30% more acceleration, turning, and top speed. Toggle off for combat configuration.',
  behavior: 'flightMode',
  activationDuration: 600,
  flightBoost: 1.3,
  // The center hull already supplies the visible body. This part carries the
  // ordinary module activation state without covering its gold panels.
  model: [{ wreckage: false }],
} satisfies ModuleSpec;
