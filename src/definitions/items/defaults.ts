import { defaultMass } from '../game-object';

export const itemDefaults = {
  mass: defaultMass,
  angularDrag: 0.15,
  radius: 8,
  bounciness: 0.2,
  health: 100,
} as const satisfies Record<string, number>;
