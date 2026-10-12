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
  [32, ...characters].toSorted((a, b) => a - b),
  'the font maps authored characters and space, excluding placeholders',
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
