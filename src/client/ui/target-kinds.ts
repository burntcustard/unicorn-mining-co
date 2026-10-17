/**
 * Targetable object kinds and their display names. Keep gameplay tags outside
 * DOM modules so production tag compression matches replicated objects.
 */
export const targetKinds = new Map([
  ['item', 'Resource'],
  ['ship', 'Ship'],
  ['station', 'Station'],
  ['asteroid', 'Asteroid'],
  ['craft', 'Wreckage'],
  ['jumpGate', 'Jump gate'],
  ['wormhole', 'Wormhole'],
]);
