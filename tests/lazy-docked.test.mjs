import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { viteBuild, viteBuildPre } from '../plugins/vite-build.js';
import { replacePreTerser } from '../plugins/replace-pre-terser.js';

const wireContract = `const item = JSON.parse('{"position":1}'); item.position === 1;`;
assert.equal(
  replacePreTerser(wireContract),
  wireContract,
  'feature stripping must preserve property names, strings and equality',
);

const directory = await mkdtemp(join(tmpdir(), 'lazy-docked-'));
const entry = `
import { playerShip } from '${resolve('src/client/player.ts')}';
import { game } from '${resolve('src/client/game.ts')}';
import { Diamond } from '${resolve('src/shared/items/diamond.ts')}';
import { renderDocked, confirmSelection, back, moveSelection } from '${resolve('src/client/ui/docked-loader.ts')}';
// The entry sees a quoted wire key; the independently loaded UI sees dot access.
playerShip.cargoContents = JSON.parse('{"cargoContents":[]}')['cargoContents'];
playerShip.cargoContents.push(new Diamond());
Object.assign(game, {uiScale:1, uiWidth:1200, uiHeight:800});
export const run = async () => {
  renderDocked(game, playerShip);
  await confirmSelection(playerShip);
  renderDocked(game, playerShip);
  await back(playerShip);
  await moveSelection(1, playerShip);
  await confirmSelection(playerShip);
  renderDocked(game, playerShip);
  return playerShip.cargoContents.length;
};
`;

const context = new Proxy(
  {},
  { get: (object, key) => object[key] ?? (() => {}) },
);
globalThis.canvas = { getContext: () => context };
globalThis.Path2D = class {
  rect() {}
  arc() {}
  lineTo() {}
  moveTo() {}
  closePath() {}
  addPath() {}
};

try {
  const bundle = await rolldown({
    input: 'lazy-docked-test',
    plugins: [
      {
        name: 'lazy-docked-test',
        resolveId: (id) =>
          id === 'lazy-docked-test' ? '\0lazy-docked-test' : undefined,
        load: (id) => (id === '\0lazy-docked-test' ? entry : undefined),
        transform: (code, id) =>
          id.endsWith('/src/client/player.ts')
            ? code + '\nplayerShip["cargoContents"] ||= [];'
            : undefined,
      },
      viteBuildPre(),
      { ...viteBuild(), generateBundle: undefined },
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
  assert(
    output.some(
      (chunk) =>
        chunk.type === 'chunk' &&
        chunk.isDynamicEntry &&
        Object.keys(chunk.modules).some((id) => id.endsWith('/ui/docked.ts')),
    ),
    'docked UI must remain a separately compiled lazy chunk',
  );
  const { run } = await import(pathToFileURL(join(directory, 'entry.mjs')));
  assert.equal(
    await run(),
    1,
    'cargo and hull menus work across the lazy boundary',
  );
  console.log('Production lazy docked chunk renders cargo and hull menus');
} finally {
  await rm(directory, { recursive: true, force: true });
}
