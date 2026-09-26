import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { buildPlugin } from '../plugins/build-plugins.js';
import { replacePreTerser } from '../plugins/replace-pre-terser.js';

const pathSource = `import './shape-distance'; export * from "../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { distance: 1 }; state.distance = -distance;`;

assert.equal(
  replacePreTerser(pathSource),
  `import './shape-distance'; export * from "../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { _distance: 1 }; state._distance = -_distance;`,
  'quoted chunk paths must stay intact while distance is mangled',
);

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

          if (id === './__mangle_lazy.ts' && importer === entryId) {
            return lazyId;
          }
        },
        load: (id) => {
          if (id === entryId) {
            return `const state = { ${property}: 1, distance: 2 };
export async function run() {
  const { default: increment } = await import('./__mangle_lazy.ts');
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
      { ...buildPlugin(), generateBundle: undefined },
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
  const { run } = await import(pathToFileURL(join(directory, 'entry.mjs')));

  assert.equal(await run(), 16, 'both chunks must use the same mangled names');
  console.log('Property names are mangled consistently across lazy chunks');
} finally {
  await rm(directory, { recursive: true, force: true });
}

const keybindingEntry = resolve('src/__mangle_keybindings.ts');
const keybindingBundle = await rolldown({
  input: keybindingEntry,
  plugins: [
    {
      name: 'keybinding-fixture',
      resolveId: (id) => (id === keybindingEntry ? keybindingEntry : undefined),
      load: (id) =>
        id === keybindingEntry
          ? `import { defaultKeybindings, updateMovement } from './client/keybindings';
export function inspectBindings() {
  const actions = ['forwardThrust', 'turnLeft', 'turnRight', 'hornDrill', 'cargoHatch', 'searchLight', 'shieldGenerator', 'menuLeft', 'menuRight', 'menuUp', 'menuDown', 'menuBack', 'menuSelect'];
  return actions.map(action => defaultKeybindings[action].keys[0]);
}
export function inspectMovement() {
  const input = { thrust: 0, turn: 0 };
  updateMovement(new Set(['arrowup', 'arrowleft']), input);
  return [input.thrust, input.turn];
}`
          : undefined,
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await keybindingBundle.generate({
    format: 'esm',
    minify: true,
  });
  const chunk = output.find((item) => item.type === 'chunk');

  assert(chunk);
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  );

  assert.deepEqual(built.inspectBindings(), [
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'd',
    'h',
    'l',
    's',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Escape',
    ' ',
  ]);
  assert.deepEqual(built.inspectMovement(), [1, -1]);
} finally {
  await keybindingBundle.close();
}
