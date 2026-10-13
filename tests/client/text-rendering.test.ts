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
  textAlign: 'right', textBaseline: 'bottom', lineJoin: 'bevel', lineCap: 'butt', lineWidth: 7,
  save() { styles.push({...this}); },
  restore() { Object.assign(this, styles.pop()); },
  scale(...values) { transforms.push(values); },
  translate(...values) { transforms.push(values); },
  stroke(path) { strokes.push([path, this.strokeStyle, this.lineWidth, this.lineJoin, this.lineCap]); },
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
  [['stroke', 'A□□m+.J', 0, 13], ['fill', 'A□□m+.J', 0, 13]],
  'unsupported characters become boxes; supported glyphs retain paint order');
assert.equal(calls[1][4], '#f0f');
assert.deepEqual(calls[0].slice(5), ['16px Gemetric', 'center', 'alphabetic', 'round', 2]);
assert.deepEqual(transforms, [[2, 2], [50, 20], [1, 1]],
  'native centering uses font metrics and retains UI scale');
assert.deepEqual(ctx, initial, 'text restores the canvas drawing state');
for (const align of [-1, 0, 1]) {
  transforms.length = calls.length = 0;
  renderText({game, text: '12', x: 50, y: 20, align});
  assert.deepEqual(transforms, [[2, 2], [50, 20], [.6, .6]]);
  assert.equal(calls[0][6], ['left', 'center', 'right'][align + 1]);
  assert.equal(calls[1][4], '#fff');
}
transforms.length = calls.length = 0;
renderText({game, text: 'aΩ🦄? □', x: 50, y: 20, size: 1, align: 0});
assert.equal(calls[1][1], 'aΩ🦄□ □',
  'new glyphs render automatically, spaces stay blank and boxes render directly');
assert.deepEqual(transforms, [[2, 2], [50, 20], [1, 1]],
  'native alignment handles non-BMP glyphs');
const path = new Path2D('M0 0L10 0');
const outline = radius => {
  strokes.length = 0;
  pathOutline({ctx, path, radius});
  return strokes[0];
};
const narrow = outline(1), wide = outline(2);
assert.equal(narrow[0], path);
assert.equal(wide[0], path);
assert.equal(narrow[2], initial.lineWidth + 2, 'the narrow halo expands both sides');
assert.equal(wide[2], initial.lineWidth + 4, 'a larger halo covers a larger border');
assert.deepEqual(wide.slice(3), ['round', 'round'], 'line ends and corners have rounded halos');
assert.deepEqual(ctx, initial, 'outlines restore the original drawing state');
Reflect.set(document.fonts, 'check', () => true);
const images = [], cachedContext = {
  ...ctx, globalAlpha: .35,
  measureText() { return {actualBoundingBoxLeft: 13, actualBoundingBoxRight: 13, actualBoundingBoxAscent: 13, actualBoundingBoxDescent: 0}; },
  drawImage(...args) { images.push([...args, this.globalAlpha]); },
};
const cachedGame = {ctx: cachedContext, uiScale: 2};
calls.length = 0;
for (let frame = 0; frame < 12; frame++) {
  renderText({game: cachedGame, text: 'AB', x: 50, y: 20, size: 1, align: 0});
}
assert.equal(calls.length, 14, 'the first seven frames draw text natively');
assert.equal(images.length, 5, 'unchanged labels reuse their pixel image');
assert.deepEqual(images[0].slice(1), [-15, -2, 30, 17, .35],
  'font ink bounds include the outline and preserve centering and caller opacity');
assert.equal(images[0][0].width, 60);
assert.equal(images[0][0].height, 34);
assert.deepEqual(Reflect.get(globalThis, 'text-image-options'), {willReadFrequently: true},
  'production builds preserve the native backing-store option');
assert.deepEqual(Reflect.get(globalThis, 'text-image-paints'), [['stroke', 'AB', 0, 13], ['fill', 'AB', 0, 13]],
  'the cached image retains the native outline and fill order');
renderText({game: cachedGame, text: 'AC', x: 50, y: 20, size: 1, align: 0});
assert.equal(calls.length, 16, 'changing readouts immediately draw their new text');
assert.equal(cachedContext.globalAlpha, .35);
const numericStart = images.length;
for (const text of ['12', '12', '13']) {
  renderText({game: cachedGame, text, x: 80, y: 20, size: 1, align: 0});
}
assert.equal(images.length, numericStart + 3, 'numeric readouts use their pixel image immediately');
assert.equal(images[numericStart][0], images[numericStart + 2][0],
  'changed numeric values reuse the same canvas');
assert.deepEqual(Reflect.get(globalThis, 'text-image-paints'),
  [['stroke', '12', 0, 13], ['fill', '12', 0, 13], ['stroke', '13', 0, 13], ['fill', '13', 0, 13]],
  'changing readouts repaint their complete native text, preserving kerning');
assert.equal(calls.length, 16, 'numeric readouts keep text rasterization off the foreground');
for (let index = 0; index < 40; index++) {
  renderText({game: cachedGame, text: 'LABEL ' + index, x: 50, y: 20});
}
const beforeEviction = images.length;
renderText({game: cachedGame, text: 'AB', x: 50, y: 20, size: 1, align: 0});
assert.equal(images.length, beforeEviction, 'a bounded cache evicts labels after enough other values');
console.log('Native font drawing, layout, fallback cells, canvas state and non-text outlines passed');
`;

Object.assign(globalThis, {
  document: {
    fonts: { load: async (font: string) => font, check: () => false },
    createElement() {
      const paints: unknown[] = [];

      Reflect.set(globalThis, 'text-image-paints', paints);

      return {
        width: 0,
        height: 0,
        getContext(_type: string, options: CanvasRenderingContext2DSettings) {
          Reflect.set(globalThis, 'text-image-options', options);

          return {
            resetTransform() {},
            clearRect() {},
            translate() {},
            scale() {},
            strokeText(...args: unknown[]) {
              paints.push(['stroke', ...args]);
            },
            fillText(...args: unknown[]) {
              paints.push(['fill', ...args]);
            },
          };
        },
      };
    },
  },
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
    Reflect.set(document.fonts, 'check', () => false);
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
