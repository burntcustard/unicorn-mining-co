import { propertyNames } from './property-names.js';
import { protocolTags, encodeProtocolTags } from './protocol-tags.js';

// Kontra-style compile-time flags. `@ifdef` keeps a block when its flag is
// truthy, while `@ifndef` keeps it when false.
const ifdefPattern =
  /^[ \t]*\/\/ @(ifdef|ifndef) (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

/**
 * Strip compile-time feature blocks before TypeScript is transpiled.
 */
export const stripIfdef = (source, flags = {}) =>
  source.replace(ifdefPattern, (match, condition, flag, body) =>
    (condition === 'ifdef') === !!flags[flag] ? body : '',
  );

const tagPattern = new RegExp(
  '([\'"`])(' + protocolTags.join('|') + ')\\1',
  'g',
);

// Consume complete quoted strings before matching properties. A path-like
// string stays literal; other strings may contain dynamic property keys.
// Matching only path-like quotes can mistake code between two literals for a
// path when that code contains a ternary colon.
const propertyNamePattern = new RegExp(
  `\\b(${propertyNames.join('|')})\\b`,
  'g',
);
const propertyPattern = new RegExp(
  String.raw`(["'])(?:\\.|(?!\1)[^\\\r\n])*\1|\b(?:export\s+)?function\s+distance\b|\bVec\.distance\b|\b(${propertyNames.join('|')})\b`,
  'g',
);

/**
 * Source-level rewrites that help Terser compress the production JavaScript.
 */
export const replacePreTerser = (src) =>
  src
    .replace(
      tagPattern,
      (_, quote, tag) => quote + encodeProtocolTags.get(tag) + quote,
    )
    .replace(propertyPattern, (match, quote, name) => {
      if (quote) {
        return match.includes('/') || /[:-]/.test(match)
          ? match
          : match.replace(propertyNamePattern, (property) => `_${property}`);
      }

      return name ? `_${name}` : match;
    });
