/**
 * Exact client gameplay tags replaced with short strings in production.
 * List order determines the one-byte value assigned to each tag.
 */
export const protocolTags = [
  'hello',
  'progress',
  'input',
  'dock',
  'respawn',
  'welcome',
  'load',
  'snapshot',
  'asteroid',
  'item',
  // 'object', // Returned by typeof, so we cannot replace it.
  'ship',
  'station',
  'wreck',
  'craft',
  'asteroidSplit',
  'asteroidDestroyed',
  'drillDamage',
  'collision',
  'itemCollected',
  'docked',
  'moduleChanged',
  'cargoHatch',
  'hornDrill',
  'searchLight',
  'shieldGenerator',
  'snapshotAck',
  'projectile',
  'buyAmmo',
  'objectDestroyed',
  'explosion',
];

/**
 * Map each tag to a single ASCII byte in list order.
 * These are internal client literals; Go uses numeric binary wire IDs.
 */
export const encodeProtocolTags = new Map(
  protocolTags.map((tag, index) => [tag, String.fromCharCode(97 + index)]),
);
