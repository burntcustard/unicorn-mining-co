import assert from 'node:assert/strict';
import { Font, woff2 } from 'fonteditor-core';
import { generateFont, glyphContours } from '../../scripts/generate-font.ts';
import { glyphPaths } from '../../font/glyph-paths.ts';

const buffer = await generateFont();
const font = Font.create(buffer, { type: 'woff2' }).get();
const characters = Object.entries(glyphPaths)
  .filter(([character, path]) => Array.from(character).length === 1 && !!path)
  .map(([character]) => character.codePointAt(0)!);

for (const character of 'abcdefghijklmnopqrstuvwxyz') {
  const path = glyphPaths[character as keyof typeof glyphPaths];

  assert.ok(
    typeof path === 'string' && path,
    `lowercase ${character} is authored`,
  );
  assert.ok(
    path
      .match(/-?\d+(?:\.\d+)?/g)
      ?.every((coordinate) => Number.isInteger(Number(coordinate) * 2)),
    `lowercase ${character} uses whole- or half-unit coordinates`,
  );
  assert.ok(
    font.cmap[character.codePointAt(0)!],
    `lowercase ${character} is generated`,
  );
}

assert.deepEqual(
  Object.keys(font.cmap).map(Number),
  [32, 0x2009, ...characters].toSorted((a, b) => a - b),
  'the font maps authored characters and space, excluding placeholders',
);

const space = font.glyf[font.cmap[32]];
const thinSpace = font.glyf[font.cmap[0x2009]];
const filledStar = font.glyf[font.cmap['★'.codePointAt(0)!]];
const outlinedStar = font.glyf[font.cmap['☆'.codePointAt(0)!]];
const infinity = font.glyf[font.cmap['∞'.codePointAt(0)!]];

assert.equal(infinity.contours.length, 3, 'infinity has two enclosed loops');

assert.equal(filledStar.contours.length, 1, 'the solid star has no hole');
assert.equal(outlinedStar.contours.length, 2, 'the outlined star has a hole');
assert.equal(filledStar.advanceWidth, outlinedStar.advanceWidth);
assert.equal(filledStar.leftSideBearing, outlinedStar.leftSideBearing);
assert.deepEqual(
  outlinedStar.contours.find((contour) => contour.some(({ x }) => x === 0)),
  filledStar.contours[0],
  'both stars have exactly the same outer shape',
);

assert.equal(thinSpace.advanceWidth * 2, space.advanceWidth);
assert.equal(
  thinSpace.contours.length,
  0,
  'thin spaces have no visible outline',
);

// Inspect the emitted OpenType table, rather than the source ligature list,
// so wrong offsets, glyph IDs, or short-before-long rules fail this check.
const trueType = Buffer.from(woff2.decode(buffer));

const tables = Array.from({ length: trueType.readUInt16BE(4) }, (_, index) => {
  const record = 12 + index * 16;

  return {
    tag: trueType.toString('ascii', record, record + 4),
    offset: trueType.readUInt32BE(record + 8),
  };
});

const gsub = tables.find(({ tag }) => tag === 'GSUB')?.offset;

assert.notEqual(gsub, undefined, 'the font includes standard ligature shaping');
const featureList = gsub! + trueType.readUInt16BE(gsub! + 6);

assert.equal(
  trueType.toString('ascii', featureList + 2, featureList + 6),
  'liga',
);
const lookupList = gsub! + trueType.readUInt16BE(gsub! + 8);
const lookup = lookupList + trueType.readUInt16BE(lookupList + 2);
const substitution = lookup + trueType.readUInt16BE(lookup + 6);
const coverage = substitution + trueType.readUInt16BE(substitution + 2);
const coverageCount = trueType.readUInt16BE(coverage + 2);
const firstGlyphs = Array.from({ length: coverageCount }, (_, index) =>
  trueType.readUInt16BE(coverage + 4 + index * 2),
);

assert.equal(trueType.readUInt16BE(lookup), 4, 'uses ligature substitution');
assert.equal(trueType.readUInt16BE(substitution), 1);
assert.equal(trueType.readUInt16BE(coverage), 1);

const unitLigatures = Object.entries(glyphPaths).filter(
  ([sequence, path]) => Array.from(sequence).length > 1 && !!path,
);

for (const [unitIndex, [sequence]] of unitLigatures.entries()) {
  const components = Array.from(
    sequence,
    (character) => font.cmap[character.codePointAt(0)!],
  );
  const coverageIndex = firstGlyphs.indexOf(components[0]);

  assert(coverageIndex >= 0, `${sequence}: first glyph has coverage`);
  const set =
    substitution + trueType.readUInt16BE(substitution + 6 + coverageIndex * 2);
  const ruleCount = trueType.readUInt16BE(set);
  let replacement: number | undefined;

  for (let index = 0; index < ruleCount; index++) {
    const rule = set + trueType.readUInt16BE(set + 2 + index * 2);
    const componentCount = trueType.readUInt16BE(rule + 2);
    const matches = Array.from({ length: componentCount - 1 }, (_, component) =>
      trueType.readUInt16BE(rule + 4 + component * 2),
    ).every((glyph, component) => glyph === components[component + 1]);

    if (matches) {
      replacement = trueType.readUInt16BE(rule);
      assert.equal(
        componentCount,
        components.length,
        `${sequence}: longest rule first`,
      );
      break;
    }
  }

  assert.notEqual(replacement, undefined, `${sequence} shapes`);
  assert.equal(
    replacement,
    font.glyf.length - unitLigatures.length + unitIndex,
    `${sequence}: substitutes the intended unit glyph`,
  );
  assert.equal(
    font.glyf[replacement!].advanceWidth,
    26 * 8,
    `${sequence}: two-cell width`,
  );
}

assert.ok(
  characters.every((code) => {
    const glyph = font.glyf[font.cmap[code]];

    return (
      glyph.contours.length &&
      glyph.contours.every(
        (contour) =>
          contour.length >= 3 &&
          contour.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
      )
    );
  }),
  'every authored glyph produces finite, nonempty contours',
);

assert.throws(() => glyphContours('0 0Q1 2 3 4'), /Invalid glyph/);
assert.throws(() => glyphContours('0 0 4'), /Unpaired coordinate/);
assert.throws(() => glyphContours('0 0 0 0'), /Zero-length segment/);

console.log(
  `Font generation and character coverage passed (${buffer.length} bytes)`,
);
