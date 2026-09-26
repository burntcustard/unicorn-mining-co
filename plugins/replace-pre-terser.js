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

// Protect quoted paths and Vec.distance's export before matching properties.
// This leaves shape-distance intact and lets unrelated distance fields mangle.
const propertyPattern = new RegExp(
  `(["'])(?:[^"'\\r\\n]*[/-][^"'\\r\\n]*)\\1|\\b(?:export\\s+)?function\\s+distance\\b|\\bVec\\.distance\\b|\\b(${propertyNames.join('|')})\\b`,
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
    .replace(propertyPattern, (match, _quote, name) =>
      name ? `_${name}` : match,
    );
