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
