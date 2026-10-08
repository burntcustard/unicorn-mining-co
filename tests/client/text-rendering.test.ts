/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { renderText } from '${root}/src/client/ui/text/text.ts';
import { textOutline } from '${root}/src/client/ui/text/text-outline.ts';
const strokes = [], transforms = [], styles = [];
const ctx = {
  save() { styles.push(this.strokeStyle); },
  restore() { this.strokeStyle = styles.pop(); },
  scale(...values) { transforms.push(values); },
  translate(...values) { transforms.push(values); },
  stroke(path) { strokes.push([path, this.strokeStyle]); },
};
const game = {ctx, uiScale: 2};
const draw = (text, options = {}) => {
  strokes.length = transforms.length = 0;
  renderText({game, text, x: 10, y: 20, ...options});
  return [...strokes];
};
const first = draw('AUTOGUN');
const allocations = Reflect.get(globalThis, 'pathAllocations');
const repeated = draw('AUTOGUN', {x: 30, y: 40, size: .8, color: '#f0f'});
assert.equal(Reflect.get(globalThis, 'pathAllocations'), allocations,
  'repeated HUD labels reuse geometry instead of allocating paths each frame');
assert.equal(repeated[0][0], first[0][0], 'outline geometry is shared');
assert.equal(repeated[1][0], first[1][0], 'glyph geometry is shared');
assert.equal(repeated[1][1], '#f0f', 'cached geometry does not retain stroke colour');
assert.deepEqual(transforms, [[2, 2], [30, 40], [.8, .8]],
  'cached geometry uses the current position and scale');
const changed = draw('PLASMA');
assert.notEqual(changed[1][0], first[1][0], 'different text has different glyphs');
assert.deepEqual(draw('é')[1][0], draw('X')[1][0],
  'unsupported characters still render the replacement glyph');
const path = first[1][0];
const outline = radius => {
  strokes.length = 0;
  textOutline({ctx, path, radius});
  return strokes[0][0];
};
const narrow = outline(1), wide = outline(2);
assert.notEqual(wide, narrow, 'outline radius is part of the geometry cache');
assert.equal(outline(1), narrow, 'alternating radii do not reuse the wrong outline');
const geometry = Reflect.get(wide, 'commands');
assert.equal(geometry.length, 16, 'all outline offsets are retained');
assert.deepEqual(geometry[0].slice(2), [2, 0], 'outline keeps its requested radius');
for (let i = 0; i < 256; i++) draw(String(i));
const rebuilt = draw('AUTOGUN');
assert.notEqual(rebuilt[1][0], first[1][0], 'changing labels cannot grow the cache forever');
assert.deepEqual(Reflect.get(rebuilt[1][0], 'commands'), Reflect.get(first[1][0], 'commands'),
  'evicted labels rebuild with identical glyph geometry');
assert.deepEqual(Reflect.get(rebuilt[0][0], 'commands'), Reflect.get(first[0][0], 'commands'),
  'evicted labels rebuild with identical outline geometry');
console.log('Text geometry reuse, colours, transforms, radii and eviction passed');
`;

Object.assign(globalThis, {
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

for (const production of [false, true]) {
  const entry = production ? `${root}/src/__text-test.ts` : 'text-test';

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'text-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? scenario.replace(
                /assert\.(\w+)/g,
                (_, method) => `Reflect.get(assert, '${method}')`,
              )
            : undefined,
      },
      buildPrePlugin({ DEBUG: !production }),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
