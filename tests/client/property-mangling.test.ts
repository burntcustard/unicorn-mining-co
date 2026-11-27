import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { rolldown } from 'rolldown';
import {
  buildHtmlPlugin,
  viteBackground,
} from '../../plugins/build-plugins.ts';
import { replacePreTerser } from '../../plugins/replace-pre-terser.ts';
import { testBuildPlugin } from '../support/build-plugin.ts';

const pathSource = `import '../shape-distance'; export * from "../../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { distance: 1 }; state.distance = -distance;`;

assert.equal(
  replacePreTerser(pathSource),
  `import '../shape-distance'; export * from "../../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { _distance: 1 }; state._distance = -_distance;`,
  'quoted chunk paths must stay intact while distance is mangled',
);

assert.equal(
  replacePreTerser("const role = 'hostile';"),
  "const role = 'hostile';",
  'hostile chat roles keep their wire text',
);

const stationBranch = `entity.kind === "station" ? createStation() : createShip()`;

assert.equal(
  replacePreTerser('cache.keys().next().value;'),
  'cache.keys().next().value;',
  'native map iterators survive production rewriting during cache eviction',
);

assert.equal(
  replacePreTerser('pattern.setTransform(matrix);'),
  'pattern.setTransform(matrix);',
  'native canvas pattern transforms survive production rewriting',
);

assert.equal(
  replacePreTerser('canvas.style.transform = matrix; model.transform = pose;'),
  'canvas.style.transform = matrix; _model._transform = _pose;',
  'native CSS transforms survive while physics transforms still mangle',
);

assert.equal(
  replacePreTerser(
    `element.classList.toggle('running', state.active); element.classList.remove('running'); element.classList.contains('running'); model.toggle();`,
  ),
  `element.classList.toggle('running', state._active); element.classList.remove('running'); element.classList.contains('running'); _model._toggle();`,
  'native class-list methods survive while application methods still mangle',
);

assert.equal(
  replacePreTerser('observer.disconnect(); canvas?.remove();'),
  'observer.disconnect(); canvas?.remove();',
  'native DOM cleanup must not be renamed',
);

const replacedStationBranch = replacePreTerser(stationBranch);
const encodedStation = replacePreTerser('"station"');

assert.equal(
  replacedStationBranch,
  `entity._kind === ${encodedStation} ? createStation() : createShip()`,
  'a ternary between quoted tags must mangle the entity kind access',
);

assert.equal(
  replacePreTerser(
    `element.setAttribute('id', 'ui-root'); input.setAttribute('type', 'text'); document.createElement('input'); value.trim(); model.update();`,
    { preserveStrings: true },
  ),
  `element.setAttribute('id', 'ui-root'); _input.setAttribute('type', 'text'); document.createElement('input'); value.trim(); model._update();`.replace(
    'model.',
    '_model.',
  ),
  'DOM literals and native String.trim survive production while app state still mangles',
);

assert.equal(
  replacePreTerser(
    'const description = "Launch a charged plasma projectile.";',
  ),
  'const _description = "Launch a charged plasma projectile.";',
  'prose is not rewritten as app-owned property names',
);

assert.equal(
  replacePreTerser('const pattern = /Unknown replicated entity kind/;'),
  'const pattern = /Unknown replicated entity kind/;',
  'regular expressions keep literal text intact',
);

const template =
  'const html = `<span title="${item.name}">${item.power}</span>`;';

assert.equal(
  replacePreTerser(template, { preserveStrings: true }),
  'const html = `<span title="${item._name}">${item._power}</span>`;',
  'HTML template attributes preserve their text while expressions mangle',
);

const domDirectory = resolve('src/client/ui/dom');

for (const name of readdirSync(domDirectory)) {
  if (!name.endsWith('.ts')) continue;
  const source = readFileSync(join(domDirectory, name), 'utf8');

  for (const [, literal] of source.matchAll(/\baction:\s*(['"]\w+['"])/g)) {
    assert.equal(
      replacePreTerser(literal),
      literal,
      `${name} sends ${literal}, which the game code compares in its rewritten production form`,
    );
  }
}

const entryId = resolve('src/__mangle_entry.ts');
const lazyId = resolve('src/__mangle_lazy.ts');
const property = 'crossChunkCounterForMangleTest';
const directory = await mkdtemp(join(tmpdir(), 'property-mangling-'));

try {
  const bundle = await rolldown({
    input: entryId,
    plugins: [
      {
        name: 'mangling-fixture',
        resolveId: (id, importer) => {
          if (id === entryId) return entryId;

          if (id === '../__mangle_lazy.ts' && importer === entryId) {
            return lazyId;
          }
        },
        load: (id) => {
          if (id === entryId) {
            return `const state = { ${property}: 1, distance: 2 };
export async function run() {
  const { default: increment } = await import('../__mangle_lazy.ts');
  return increment(state) + state.${property} + state.distance;
}`;
          }

          if (id === lazyId) {
            return `export default function increment(state) {
  state.${property} += 2;
  state.distance += 3;
  return state.${property} + state.distance;
}`;
          }
        },
      },
      testBuildPlugin(),
    ],
  });

  const { output } = await bundle.write({
    dir: directory,
    format: 'esm',
    minify: true,
    entryFileNames: 'entry.mjs',
    chunkFileNames: '[name]-[hash].mjs',
  });

  await bundle.close();
  const chunks = output.filter((item) => item.type === 'chunk');

  assert.equal(chunks.length, 2, 'lazy code must remain a separate chunk');
  assert(
    chunks.every((chunk) => !chunk.code.includes(property)),
    'the original property name must be mangled in both chunks',
  );
  assert(
    chunks.every((chunk) => !/\b_?distance\b/.test(chunk.code)),
    'distance must have a short property name in both chunks',
  );
  const { run } = await import(
    pathToFileURL(join(directory, 'entry.mjs')).href
  );

  assert.equal(await run(), 16, 'both chunks must use the same mangled names');
  console.log('Property names are mangled consistently across lazy chunks');
} finally {
  await rm(directory, { recursive: true, force: true });
}

const htmlPlugin = buildHtmlPlugin();

assert.equal(
  await htmlPlugin.transformIndexHtml.handler(`
    <!-- removed -->
    <div> <span>First</span> <span>Second</span> </div>
    <p>Words stay separated.</p>
    <pre>  preserved\n  spacing</pre>
    <textarea>  preserved\n  input</textarea>
  `),
  '<div><span>First</span><span>Second</span></div><p>Words stay separated.</p><pre>  preserved\n  spacing</pre><textarea>  preserved\n  input</textarea>',
  'HTML minification removes layout whitespace but preserves prose and preformatted text',
);

for (const file of readdirSync('src/client/ui/dom').filter((file) =>
  file.endsWith('.html'),
)) {
  const code = await htmlPlugin.load(
    resolve('src/client/ui/dom', file) + '?raw',
  );

  assert(code, `${file} is minified as a raw HTML module`);

  const { default: fragment } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );

  assert.doesNotMatch(
    fragment,
    />\s+</,
    `${file} has no inter-element whitespace`,
  );
}

// The inline boot renderer is built independently of the mangled main chunk.
const html = await viteBackground().transformIndexHtml.handler(
  await readFile('index.html', 'utf8'),
  {},
);
const compactHtml = await htmlPlugin.transformIndexHtml.handler(html);
const boot = compactHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];

assert.doesNotMatch(
  compactHtml,
  />\s+</,
  'the built page has no layout whitespace',
);

assert(boot, 'the background must be inlined into the HTML');
let painted = 0;
let marks = 0;
let preferences: string | null = null;

const context = new Proxy(
  {
    drawImage() {
      painted++;
    },
    fill() {
      marks++;
    },
    createRadialGradient: () => ({ addColorStop() {} }),
  },
  { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
);

const canvas = { style: {}, getContext: () => context };

const browser = createContext({
  window: new EventTarget(),
  localStorage: { getItem: () => preferences },
  canvas,
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  document: {
    createElement: () => ({ getContext: () => context }),
    querySelector: () => canvas,
  },
  Path2D: class {
    addPath() {}

    arc() {}

    closePath() {}

    lineTo() {}

    moveTo() {}
  },
  createImageBitmap: async () => ({ close() {} }),
  requestAnimationFrame: () => 0,
});

runInContext(boot, browser);
assert.equal(
  typeof browser.background.renderBackground,
  'function',
  'boot exposes a callable renderer',
);
const bootPaints = painted;

assert(bootPaints > 0, 'the boot renderer paints immediately');
assert(marks > 0, 'the default sky paints stars');
preferences = JSON.stringify([false, false, false, false, 1]);
browser.window.dispatchEvent(new Event('ui-graphics'));
marks = 0;
browser.background.renderBackground(canvas, context, 600 / 1080);
assert.equal(
  marks,
  0,
  'the browser entry reloads preferences and rebuilds the sky',
);
const backgroundEntry = resolve('src/__background_bridge.ts');

const backgroundBundle = await rolldown({
  input: backgroundEntry,
  plugins: [
    {
      name: 'background-bridge-fixture',
      resolveId: (id) => (id === backgroundEntry ? id : undefined),
      load: (id) =>
        id === backgroundEntry
          ? "globalThis.background.renderBackground(canvas, canvas.getContext('2d'), 1, 123, 456);"
          : undefined,
    },
    testBuildPlugin(),
  ],
});

try {
  const { output } = await backgroundBundle.generate({
    format: 'iife',
    minify: true,
  });

  runInContext(output[0].code, browser);
  assert(
    painted > bootPaints,
    'the mangled client can call the independent boot renderer',
  );
} finally {
  await backgroundBundle.close();
}
