import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const wireContract = `const item = JSON.parse('{"position":1}'); item.position === 1;`;

assert.equal(
  stripIfdef(wireContract),
  wireContract,
  'feature stripping must preserve property names, strings and equality',
);

const directory = await mkdtemp(join(tmpdir(), 'lazy-docked-'));
const entryId = resolve('src/__lazy_docked_test.ts');
const entry = `
import { player } from '${resolve('src/client/player.ts')}';
import { game } from '${resolve('src/client/game.ts')}';
import { init } from '${resolve('src/client/core.ts')}';
import { Item } from '${resolve('src/client/objects/item.ts')}';
import { diamond as diamondDefinition } from '${resolve('src/definitions/items/index.ts')}';
import { setCraftActionDispatcher } from '${resolve('src/client/network/craft-actions.ts')}';
import { renderDocked, confirmSelection, back, moveSelection } from '${resolve('src/client/ui/docked-loader.ts')}';
// The entry and independently loaded UI both access the same mangled state.
player.ship.cargoContents ||= [];
player.ship.cargoContents.push(new Item(diamondDefinition, ));
const sales = [];
setCraftActionDispatcher(action => {
  if (action.action === 'sell') sales.push(action);
});
const { canvas, context } = init();
Object.assign(game, {canvas, ctx:context, uiScale:1, uiWidth:1200, uiHeight:800});
export const run = async () => {
  renderDocked(game, player.ship);
  await confirmSelection(player.ship);
  renderDocked(game, player.ship);
  await confirmSelection(player.ship);
  await confirmSelection(player.ship);
  await back(player.ship);
  await moveSelection(1, player.ship);
  await confirmSelection(player.ship);
  renderDocked(game, player.ship);
  return [
    player.ship.cargoContents.length,
    sales[0]?.objectIds?.[0] === player.ship.cargoContents[0].id,
  ];
};`;

const context = new Proxy(
  {},
  { get: (object, key) => Reflect.get(object, key) ?? (() => {}) },
);

Object.assign(globalThis, { canvas: { getContext: () => context } });

Object.assign(globalThis, {
  Path2D: class {
    addPath() {}

    arc() {}

    closePath() {}

    lineTo() {}

    moveTo() {}

    rect() {}
  },
});

try {
  const bundle = await rolldown({
    input: 'lazy-docked-test',
    plugins: [
      {
        name: 'lazy-docked-test',
        resolveId: (id) => (id === 'lazy-docked-test' ? entryId : undefined),
        load: (id) => (id === entryId ? entry : undefined),
        transform: (code, id) =>
          id.endsWith('/src/client/player.ts')
            ? code + '\nplayer.ship["cargoContents"] ||= [];'
            : undefined,
      },
      buildPrePlugin(),
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
  assert(
    output.some(
      (chunk) =>
        chunk.type === 'chunk' &&
        chunk.isDynamicEntry &&
        Object.keys(chunk.modules).some((id) => id.endsWith('/ui/docked.ts')),
    ),
    'docked UI must remain a separately compiled lazy chunk',
  );
  const { run } = await import(
    pathToFileURL(join(directory, 'entry.mjs')).href
  );

  assert.deepEqual(
    await run(),
    [1, true],
    'cargo sale and hull menu work across the lazy boundary',
  );
  console.log('Production lazy docked chunk renders cargo and hull menus');
} finally {
  await rm(directory, { recursive: true, force: true });
}
