// Kontra-style compile-time flags. `@ifdef` keeps a block when its flag is
// truthy, while `@ifndef` keeps it when false.
const ifdefPattern =
  /^[ \t]*\/\/ @(ifdef|ifndef) (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

/**
 * Strip compile-time feature blocks without rewriting identifiers, properties,
 * string values or JavaScript semantics.
 */
export const replacePreTerser = (source, flags = {}) =>
  source.replace(ifdefPattern, (match, condition, flag, body) =>
    (condition === 'ifdef') === !!flags[flag] ? body : '',
  );
