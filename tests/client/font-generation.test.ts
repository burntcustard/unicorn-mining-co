import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Font, woff2 } from 'fonteditor-core';
import { generateFont, glyphContours } from '../../scripts/generate-font.ts';
import { compactTrueType } from '../../scripts/compact-font.ts';
import { glyphPaths } from '../../font/glyph-paths.ts';

const buffer = await generateFont();

assert.equal(buffer.subarray(0, 4).toString(), 'wOF2');
assert.deepEqual(buffer, await generateFont(), 'generation is deterministic');
assert.deepEqual(
  buffer,
  readFileSync(new URL('../../font/gemetric.woff2', import.meta.url)),
  'run npm run font after changing glyphs or the generator',
);

const font = Font.create(buffer, { type: 'woff2' }).get();

assert.equal(font.name.fontFamily, 'Gemetric');
assert.ok(font.cmap[74], 'uppercase J has its own glyph');
assert.notEqual(font.cmap[74], font.cmap[109], 'J is distinct from metre m');
assert.ok(font.cmap[109], 'lowercase m maps to the metre glyph');
assert.equal(
  font.glyf[font.cmap[0x25a1]].contours.length,
  2,
  'the replacement box has an outer contour and a hollow centre',
);
const expected = [
  32,
  ...Object.entries(glyphPaths)
    .filter(([, path]) => path)
    .map(([character]) => character.codePointAt(0)!),
];

assert.deepEqual(
  Object.keys(font.cmap).map(Number),
  expected.toSorted((a, b) => a - b),
  'only characters with paths and space are mapped; placeholders are excluded',
);
assert.equal(font.glyf.length, expected.length + 1, 'only .notdef is unmapped');
assert.ok(font.glyf.every((glyph) => glyph.advanceWidth === 13 * 8));
assert.equal(font.head.unitsPerEm, 16 * 8);
assert.ok(
  font.glyf.every((glyph) => !glyph.contours.length || glyph.xMin === 0),
);
assert.equal(font.head.flags & 2, 0, 'bearings are independent of stored xMin');
assert.equal(font.post.format, 3, 'do not ship glyph names');
assert.ok(
  !font.glyf[0].contours.length,
  'missing glyph has no invented artwork',
);
assert.ok(
  font.glyf
    .slice(2)
    .every(
      (glyph) =>
        glyph.contours.length &&
        glyph.contours.every(
          (contour) =>
            contour.length >= 3 &&
            contour.every(
              ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
            ),
        ),
    ),
  'every authored glyph produces finite, nonempty contours',
);
assert.equal(glyphContours('0 0 4 0M0 4 4 4').length, 2);
assert.equal(glyphContours('0 0 4 0 4 4 0 4Z').length, 2);
assert.throws(() => glyphContours('0 0Q1 2 3 4'), /Invalid glyph/);
assert.throws(() => glyphContours('0 0 4'), /Unpaired coordinate/);
assert.throws(() => glyphContours('0 0 0 0'), /Zero-length segment/);

const ttf = Buffer.from(woff2.decode(buffer));

const tables = new Map(
  Array.from({ length: ttf.readUInt16BE(4) }, (_, i) => {
    const offset = 12 + i * 16;
    const start = ttf.readUInt32BE(offset + 8);

    return [
      ttf.toString('ascii', offset, offset + 4),
      ttf.subarray(start, start + ttf.readUInt32BE(offset + 12)),
    ] as const;
  }),
);

assert.deepEqual(
  [...tables.keys()].sort(),
  [
    'OS/2',
    'cmap',
    'glyf',
    'head',
    'hhea',
    'hmtx',
    'loca',
    'maxp',
    'name',
    'post',
  ],
  'all required TrueType tables remain, without hinting or optional tables',
);
assert.equal(tables.get('OS/2')!.length, 78);
assert.equal(tables.get('OS/2')!.readUInt16BE(0), 0);
assert.equal(
  tables.get('OS/2')!.readUInt32BE(46),
  0,
  'do not advertise private-use glyphs',
);
const names = tables.get('name')!;

const nameIds = Array.from({ length: names.readUInt16BE(2) }, (_, i) => {
  assert.equal(names.readUInt16BE(6 + i * 12), 3, 'only Unicode Windows names');
  return names.readUInt16BE(12 + i * 12);
});

assert.deepEqual(nameIds, [1, 2, 4, 6]);
assert.equal(
  names.readUInt16BE(16),
  names.readUInt16BE(40),
  'family and full name share storage',
);
assert.ok(
  tables
    .get('head')!
    .subarray(20, 36)
    .every((byte) => byte === 0),
);
let checksum = 0;

for (let i = 0; i < ttf.length; i += 4) {
  checksum = (checksum + ttf.readUInt32BE(i)) >>> 0;
}

assert.equal(checksum, 0xb1b0afba, 'compacted TrueType checksum remains valid');

// Exercise both Unicode subtable formats without adding glyphs to Gemetric.
const extendedFont = Font.create(buffer, { type: 'woff2' });

extendedFont.get().glyf[font.cmap[109]].unicode.push(0x1f984);

const extended = Font.create(
  compactTrueType({
    buffer: extendedFont.write({ type: 'ttf', toBuffer: true }),
    family: 'Gemetric',
  }),
  { type: 'ttf' },
).get();

assert.equal(
  extended.cmap[0x1f984],
  extended.cmap[109],
  'compaction retains mappings outside the BMP alongside ASCII',
);
assert.ok(extended.cmap[65], 'the BMP map still contains uppercase A');

console.log(
  `Font coverage, contours, metrics and reproducibility passed (${buffer.length} bytes)`,
);
