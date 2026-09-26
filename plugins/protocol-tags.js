/**
 * Exact protocol and equipment tags shared by client and server builds.
 * List order determines the one-byte value assigned to each tag.
 */
export const protocolTags = [
  'hello',
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
];

/**
 * Map each tag to a lowercase ASCII byte in list order.
 * Both builds use these values when encoding protocol strings.
 */
export const encodeProtocolTags = new Map(
  protocolTags.map((tag, index) => [tag, String.fromCharCode(97 + index)]),
);
