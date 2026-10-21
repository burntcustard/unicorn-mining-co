// Timing is in simulation seconds, distances in world units, and angles in radians.
export const pirateSpec = {
  // Pause after announcing an attack before firing can begin.
  attackDelay: 3,

  // Pause after accepting surrendered cargo before collecting it.
  collectDelay: 3,

  // Time between demanding cargo and beginning the countdown.
  demandDelay: 10,
  // Pause from noticing stolen loot to demanding its return, then to counting down.
  lootTheftDelay: 3,
  reDemandDelay: 3,
  countdownFrom: 5,

  // Pause before the final ellipsis and again before announcing an attack.
  countdownPause: 3,
  tauntInterval: 60,
  searchDuration: 100,

  // Mined cargo must exceed this credit value to attract a pirate.
  cargoValueThreshold: 200,
  dispatchInterval: 1,
  encounterDuration: 600,

  // Extra time to release cargo before an expired encounter is removed.
  cargoReleaseTimeout: 10,
  encounterCooldown: 120,

  // Distance from the last report at which an unseen target triggers a search.
  reportArrivalDistance: 10,
  startingCredits: 1000,

  // Distance beyond which a waiting pirate follows its target again.
  // Pirates also approach within this range before demanding cargo.
  followStartDistance: 300,

  // Preferred spacing while approaching or following a cargo-demand target.
  followDistance: 220,
  passDistance: 70,
  firingDistance: 700,
  aimTolerance: 0.12,
  aimPredictionTime: 1,
} as const;
