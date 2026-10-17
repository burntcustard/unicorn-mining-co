import assert from 'node:assert/strict';
import { Font } from 'fonteditor-core';
import { generateFont, glyphContours } from '../../scripts/generate-font.ts';
import { glyphPaths } from '../../font/glyph-paths.ts';

const buffer = await generateFont();
const font = Font.create(buffer, { type: 'woff2' }).get();
const characters = Object.entries(glyphPaths)
  .filter(([, path]) => path)
  .map(([character]) => character.codePointAt(0)!);

for (const character of 'abcdefghijklmnopqrstuvwxyz') {
  const path = glyphPaths[character as keyof typeof glyphPaths];

  assert.ok(path, `lowercase ${character} is authored`);
  assert.ok(!path.includes('.'), `lowercase ${character} uses integer points`);
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
