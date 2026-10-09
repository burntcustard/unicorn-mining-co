import assert from 'node:assert/strict';
import { createSpecimens } from '../../src/tools/font-viewer/specimen.ts';
import { glyphPaths } from '../../font/glyph-paths.ts';

const characters = Object.entries(glyphPaths)
  .filter(([, path]) => path)
  .map(([character]) => character)
  .sort();
const specimens = createSpecimens(characters);

assert.equal(
  [...new Set(specimens.uppercase.replace(/[^A-Z]/g, ''))].sort().join(''),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'every uppercase letter appears, including J',
);
assert.equal(specimens.lowercase, specimens.uppercase.toLowerCase());
assert.equal(
  [...new Set(specimens.lowercase.replace(/[^a-z]/g, ''))].sort().join(''),
  'abcdefghijklmnopqrstuvwxyz',
  'missing lowercase glyphs remain in the specimen',
);
const combined = Object.values(specimens).join('');

assert.ok(characters.every((character) => combined.includes(character)));
assert.equal(new Set(specimens.symbols).size, specimens.symbols.length);

const extended = createSpecimens([...characters, 'J', 'a', '?']);

assert.equal(extended.uppercase, specimens.uppercase);
assert.equal(extended.lowercase, specimens.lowercase);
assert.equal(
  extended.symbols,
  specimens.symbols + '?',
  'new symbols appear automatically; letters already have a place in the pangrams',
);
assert.equal(
  createSpecimens([]).uppercase,
  specimens.uppercase,
  'alphabet coverage does not depend on which glyphs exist',
);
console.log(
  'Both cases cover the whole alphabet and new symbols appear immediately',
);
