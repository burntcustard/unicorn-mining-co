/**
 * Source-level rewrites that help Terser/Roadroller compress the JS further.
 */
export const replacePreTerser = (src) => src
  // Whole-word matches only, so e.g. "pointsFor" and "moduleOption" are left
  // alone; (?<!/) then skips a match right after a slash, so import paths
  // like './message' keep their real file name instead of './_message'.
  .replace(new RegExp(`(?<!/)\\b(${[
    'actions', // -3B
    'active', // -29B
    'detach', // -4B
    'forward', // -11B
    'green', // -20B most colors are auto-mangled; green isn't
    'items', // -44B
    'item', // -9B
    'level', // -3B
    'lines', // -49B
    'mask', // -12B
    'message', // -7B
    'module', // -9B
    'mount', // -22B
    'name', // -34B
    // 'model', // +21B
    'normalize', // -21B
    'note', // -3B
    'object', // -4B
    // 'offset', // +19B
    'order', // -33B
    'outline', // -51B
    'path', // -3B
    'pitch', // -1B
    'points', // -35B
    'position', // -13B
    'radius', // -28B
    // 'red', // +13B most colors are auto-mangled; red isn't
    'remove', // -8B
    'resource', // -12B
    'rotation', // -15B
    'segments', // -13B
    'span', // -1B
    'speed', // -4B
    'target', // -4B
    'toggle', // -3B
    'turn', // -3B
    'unlock', // -3B
    'update', // -19B
    'zIndex', // -31B
  ].join('|')})\\b`, 'g'), '_$1')
  // Dangerously replace strict equality with loose equality, saves 12B
  .replace(/===/g, '==')
  // Swap forEach with map with unused return values, saves 20B
  .replaceAll('.forEach(', '.map(')
  // Standardize 2 * Math.PI to Math.PI * 2, saves 1B, maybe
  .replaceAll('2 * Math.PI', 'Math.PI * 2')
  // Keep lexical declarations consistent before bundling and Terser, saves 48B
  .replaceAll('const ', 'let ');
