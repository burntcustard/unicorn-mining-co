import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Exercise Vite's real glob expansion against the authored module files.
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});

try {
  const { catalog } = (await server.ssrLoadModule(
    '/src/tools/module-viewer/catalog.ts',
  )) as typeof import('../../src/tools/module-viewer/catalog');
  const { moduleIds } = (await server.ssrLoadModule(
    '/src/specs/modules/index.ts',
  )) as typeof import('../../src/specs/modules');

  assert.deepEqual(
    catalog.map(({ id }) => id).sort(),
    [...moduleIds].sort(),
    'every registered module appears exactly once, without helper specs',
  );

  for (const entry of catalog) {
    const relativePath = entry.source.split('/modules/')[1];
    const [category, ...rest] = relativePath.split('/');
    const file = rest.pop()!;

    assert(existsSync(resolve('src/tools/module-viewer', entry.source)));
    assert.equal(entry.category, category);
    assert.equal(entry.folder, rest.join('/'));
    assert(file.endsWith('.ts'));
    assert.equal(entry.Type.definitionId, entry.id);
  }

  const core = catalog.filter(({ category }) => category === 'core');

  for (const folder of ['power-plants', 'thrusters']) {
    const filtered = core.filter((entry) => entry.folder === folder);

    assert(filtered.length > 0, `${folder} can be selected from core`);
    assert(filtered.every(({ source }) => source.includes(`/core/${folder}/`)));
  }

  assert(catalog.some(({ category }) => category === 'offense'));
  assert(catalog.some(({ category }) => category === 'utility'));
} finally {
  await server.close();
}
