// Timing is in simulation seconds; distances are in world units.
export const marauderSpec = {
  ship: 'crescent',
  checkInterval: 300,
  minimumDistance: 50_000,
  spawnDistance: 5_000,
  despawnDistance: 5_000,
  arrivalDistance: 30,
  combatDistance: 1_000,
  combatDelay: 1,
  passDistance: 70,
  firingDistance: 1_000,
  aimTolerance: 0.12,
} as const;
