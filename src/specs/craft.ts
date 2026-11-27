// Shared fallbacks for ships, stations, hulls, and fitted module segments.
export const defaultFriction = 0.2;
export const defaultHealth = 100;
export const hullBounciness = 0.2;
export const defaultActivationDuration = 0.1;

// Assisted mounts can turn up to four degrees from the craft's forward direction.
export const weaponAimLimit = Math.PI / 45;

// Broken craft fragments decay separately from intact wrecks.
export const wreckageDecay = 1;
export const wreckageHealth = 9;
