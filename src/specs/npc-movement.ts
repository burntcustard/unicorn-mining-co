// Movement timing is in simulation seconds; distances are world units.
export const npcMovement = {
  // Seconds between steering decisions. Thrust and turn inputs are held until
  // the next decision, when the NPC checks its target and surroundings again.
  decisionInterval: 0.2,

  // Extra distance around the physical hull for routing and obstacle avoidance.
  // Smaller values allow the NPC to use narrower gaps between obstacles.
  clearanceDistance: 1,

  // Seconds ahead to simulate thrust and turning when checking for collisions.
  // Also keeps pursuit active through brief periods of target braking.
  predictionTime: 2,

  // Time scale in seconds for correcting the difference between desired and
  // current velocity. Lower values make speed corrections more aggressive.
  // Pursuit forecasts look ahead by at most twice this time scale.
  responseTime: 0.5,

  // Maximum distance to the next steering waypoint while detouring around
  // obstacles along a planned route.
  routeLookahead: 200,

  // Distance the destination must move before the NPC replaces its cached
  // route with a new route to the updated position.
  replanDistance: 120,
} as const;
