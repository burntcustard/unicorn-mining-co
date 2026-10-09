/* global Buffer, process */
import { rolldown } from 'rolldown';
import assert from 'node:assert/strict';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { glyphPaths } from '../../font/glyph-paths.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { renderText } from '${root}/src/client/ui/text.ts';
import { pathOutline } from '${root}/src/client/ui/path-outline.ts';
assert.equal(typeof document.fonts.load, 'function',
  'the production property rewrite must preserve native FontFaceSet.load');
const strokes = [], transforms = [], styles = [], calls = [];
const ctx = {
  fillStyle: '#123', strokeStyle: '#456', font: '10px serif',
  textAlign: 'right', textBaseline: 'bottom', lineJoin: 'bevel', lineWidth: 7,
  save() { styles.push({...this}); },
  restore() { Object.assign(this, styles.pop()); },
  scale(...values) { transforms.push(values); },
  translate(...values) { transforms.push(values); },
  stroke(path) { strokes.push([path, this.strokeStyle]); },
  strokeText(...args) { calls.push(['stroke', ...args, this.strokeStyle, this.font, this.textAlign, this.textBaseline, this.lineJoin, this.lineWidth]); },
  fillText(...args) { calls.push(['fill', ...args, this.fillStyle]); },
};
const game = {ctx, uiScale: 2};
const allocations = Reflect.get(globalThis, 'pathAllocations');
const initial = {...ctx};
renderText({game, text: 'Aé😀m+.J', x: 50, y: 20, size: 1, align: 0, color: '#f0f'});
assert.equal(Reflect.get(globalThis, 'pathAllocations'), allocations,
  'native text allocates no Path2D geometry');
assert.deepEqual(calls.map(call => call.slice(0, 4)),
  [['stroke', 'A□□m□□J', 0, 13], ['fill', 'A□□m□□J', 0, 13]],
  'unsupported characters become boxes; supported glyphs retain paint order');
assert.equal(calls[1][4], '#f0f');
assert.deepEqual(calls[0].slice(5), ['16px Gemetric', 'left', 'alphabetic', 'round', 2]);
assert.deepEqual(transforms, [[2, 2], [4.5, 20], [1, 1]],
  'native centering retains the 13-unit advance and UI scale');
assert.deepEqual(ctx, initial, 'text restores the canvas drawing state');
for (const align of [-1, 0, 1]) {
  transforms.length = calls.length = 0;
  renderText({game, text: '12', x: 50, y: 20, align});
  assert.deepEqual(transforms, [[2, 2], [50 - (align + 1) * 7.8, 20], [.6, .6]]);
  assert.equal(calls[1][4], '#fff');
}
transforms.length = calls.length = 0;
renderText({game, text: 'aΩ🦄? □', x: 50, y: 20, size: 1, align: 0});
assert.equal(calls[1][1], 'aΩ🦄□ □',
  'new glyphs render automatically, spaces stay blank and boxes render directly');
assert.deepEqual(transforms, [[2, 2], [11, 20], [1, 1]],
  'non-BMP glyphs occupy one cell when centering text');
const path = new Path2D('M0 0L10 0');
const outline = radius => {
  strokes.length = 0;
  pathOutline({ctx, path, radius});
  return strokes[0][0];
};
const narrow = outline(1), wide = outline(2);
assert.notEqual(wide, narrow, 'non-text outlines still cache by radius');
assert.equal(outline(1), narrow);
assert.equal(Reflect.get(wide, 'commands').length, 16);
assert.deepEqual(Reflect.get(wide, 'commands')[0].slice(2), [2, 0]);
console.log('Native font drawing, layout, fallback cells, canvas state and non-text outlines passed');
`;

Object.assign(globalThis, {
  document: { fonts: { load: async (font: string) => font } },
  pathAllocations: 0,
  Path2D: class {
    commands: unknown[] = [];

    constructor(source?: string) {
      Reflect.set(
        globalThis,
        'pathAllocations',
        Reflect.get(globalThis, 'pathAllocations') + 1,
      );

      if (source) this.commands.push(source);
    }

    addPath(
      path: { commands: unknown[] },
      transform: { e?: number; f?: number },
    ) {
      this.commands.push([
        'add',
        path.commands,
        transform.e || 0,
        transform.f || 0,
      ]);
    }
  },
});

// Only the build-time source changes: the renderer must discover new glyphs
// and ignore placeholders without any generated file or mocked character list.
const extraGlyphs = {
  a: glyphPaths.A,
  Ω: glyphPaths.O,
  '🦄': glyphPaths.U,
  '?': '',
};

Object.assign(glyphPaths, extraGlyphs);

try {
  for (const production of [false, true]) {
    const entry = production ? `${root}/src/__text-test.ts` : 'text-test';

    const bundle = await rolldown({
      input: entry,
      external: ['node:assert/strict'],
      plugins: [
        {
          name: 'text-test',
          resolveId: (id) => (id === entry ? entry : undefined),
          load: (id) => {
            if (id === entry) {
              return scenario.replace(
                /assert\.(\w+)/g,
                (_, method) => `Reflect.get(assert, '${method}')`,
              );
            }
          },
        },
        buildPrePlugin({ DEBUG: !production }),
        ...(production
          ? [{ ...buildPlugin(), generateBundle: undefined }]
          : []),
      ],
    });

    const { output } = await bundle.generate({ format: 'esm' });

    await bundle.close();
    assert.ok(
      Object.values(glyphPaths).every(
        (path) => !path || !output[0].code.includes(path),
      ),
      'glyph paths are not shipped in the browser bundle',
    );
    await import(
      'data:text/javascript;base64,' +
        Buffer.from(output[0].code).toString('base64')
    );
  }
} finally {
  for (const character of Object.keys(extraGlyphs)) {
    Reflect.deleteProperty(glyphPaths, character);
  }
}
