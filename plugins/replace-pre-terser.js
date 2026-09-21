// Kontra-style compile-time flags. `@ifdef` keeps a block when its flag is
// truthy, while `@ifndef` keeps it when false.
// eslint-disable-next-line @stylistic/max-len -- the regex must stay contiguous
const ifdefPattern =
  /^[ \t]*\/\/ @(ifdef|ifndef) (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

const renamedWords = [
  'actions',
  'active',
  'detach',
  'forward',
  'green',
  'items',
  'item',
  'level',
  'lines',
  'mask',
  'message',
  'module',
  'mount',
  'name',
  'normalize',
  'note',
  'object',
  'order',
  'outline',
  'path',
  'pitch',
  'points',
  'position',
  'radius',
  'remove',
  'resource',
  'rotation',
  'segments',
  'span',
  'speed',
  'target',
  'toggle',
  'turn',
  'unlock',
  'update',
  'zIndex',
];

const renamedWordPattern = new RegExp(
  `(?<!/)\\b(${renamedWords.join('|')})\\b`,
  'g',
);

/** Source-level rewrites that give Terser more consistent input. */
export const replacePreTerser = (source, flags = {}) =>
  source
    .replace(ifdefPattern, (match, condition, flag, body) =>
      (condition === 'ifdef') === !!flags[flag] ? body : '',
    )
    // Whole-word matches leave names such as pointsFor and moduleOption alone.
    // The negative lookbehind skips import paths such as './message', while the
    // underscore gives selected identifiers and properties one shared spelling.
    .replace(renamedWordPattern, '_$1')
    // Strict equality is deliberately weakened throughout production code.
    .replace(/===/g, '==')
    // Keep equivalent full-circle expressions consistently ordered.
    .replaceAll('2 * Math.PI', 'Math.PI * 2')
    // Keep lexical declarations consistent before bundling and Terser.
    .replaceAll('const ', 'let ');
