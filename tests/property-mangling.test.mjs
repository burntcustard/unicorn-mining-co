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

const stationBranch = `entity.kind === "station" ? createStation() : createShip()`;
const replacedStationBranch = replacePreTerser(stationBranch);
const encodedStation = replacePreTerser('"station"');

assert.equal(
  replacedStationBranch,
  `entity._kind === ${encodedStation} ? createStation() : createShip()`,
  'a ternary between quoted tags must mangle the entity kind access',
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
          ? `import { defaultKeybindings, moduleBinding, updateMovement } from './client/keybindings';
export function inspectBindings() {
  const bindings = [defaultKeybindings.forwardThrust, defaultKeybindings.turnLeft, defaultKeybindings.turnRight, moduleBinding('hornDrill'), moduleBinding('cargoHatch'), moduleBinding('searchLight'), moduleBinding('shieldGenerator'), defaultKeybindings.menuLeft, defaultKeybindings.menuRight, defaultKeybindings.menuUp, defaultKeybindings.menuDown, defaultKeybindings.menuBack, defaultKeybindings.menuSelect];
  return bindings.map(binding => binding.keys[0]);
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
  assert(
    !/\b(?:forwardThrust|turnLeft|turnRight|menuLeft|menuRight|menuUp|menuDown|menuBack|menuSelect)\b/.test(
      chunk.code,
    ),
    'action properties must be short in the built client',
  );
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

const inputEntry = resolve('src/__mangle_input.ts');
const inputBundle = await rolldown({
  input: inputEntry,
  plugins: [
    {
      name: 'input-fixture',
      resolveId: (id) => (id === inputEntry ? inputEntry : undefined),
      load: (id) => {
        if (id === inputEntry) {
          return `import { initKeys, playerInput } from './client/input';
import { packPlayerInput, unpackPlayerInput } from './shared/protocol/input';
import { moduleControls } from './shared/craft/control-ship';
export function pressModuleKeys() {
  globalThis.window = new EventTarget();
  const stop = initKeys();
  for (const key of ['d', 'h', 'l', 's']) {
    window.dispatchEvent(Object.assign(new Event('keydown'), { key, repeat: false }));
    window.dispatchEvent(Object.assign(new Event('keyup'), { key }));
  }
  const bits = packPlayerInput(playerInput);
  const active = moduleControls.map(({ readInput }) => readInput(unpackPlayerInput(bits)));
  stop();
  return [bits, active];
}`;
        }

        if (id.endsWith('/src/client/sound-loader.ts')) {
          return 'export const unlockAudio = () => {};';
        }
      },
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await inputBundle.generate({
    format: 'esm',
    minify: true,
  });
  const chunk = output.find((item) => item.type === 'chunk');

  assert(chunk);
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  );

  assert.deepEqual(built.pressModuleKeys(), [15, [true, true, true, true]]);
} finally {
  await inputBundle.close();
}

// Performance-sensitive dynamic property handling must survive the production
// build too: checking a long literal against a mangled key silently bypassed
// the asteroid segment cache while preserving every network packet.
const replicationEntry = resolve('src/__mangle_replication.ts');
const replicationBundle = await rolldown({
  input: replicationEntry,
  platform: 'node',
  plugins: [
    {
      name: 'replication-mangling-fixture',
      resolveId: (id) => (id === replicationEntry ? id : undefined),
      load: (id) =>
        id === replicationEntry
          ? `
import { ReplicationManager } from './server/replication';
import { createWorld, addEntity } from './shared/simulation/world';
import { createAsteroid } from './shared/simulation/asteroid';
import { createShip } from './shared/craft/create-ship';
export function inspectSegments(locked) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  const rock = addEntity(world, createAsteroid(world, { radius: 40, position: { ...ship.position } }));
  if (locked) rock.lockGeometry();
  rock.segments[0].health--;
  const replication = new ReplicationManager();
  const options = { world, shipId: ship.id };
  const stringify = JSON.stringify;
  let serialized = 0;
  JSON.stringify = (value, ...args) => {
    if (Array.isArray(value) && value[0]?.shapeOutline) serialized++;
    return stringify(value, ...args);
  };
  try {
    const initial = replication.initial(options).fullEntities.find(record => record.id === rock.id);
    const results = [!!initial.segments];
    for (let tick = 0; tick < 10; tick++) {
      world.tick++;
      results.push(!replication.snapshot(options).fullEntities.some(record => record.id === rock.id));
    }
    const mutations = [
      () => rock.segments[0].health--,
      () => rock.segments[0].contents.push(3),
      () => {
        rock.segments = rock.segments.map(segment => ({ ...segment, shapeOutline: segment.shapeOutline.map(point => [...point]) }));
        rock.segments[0].shapeOutline[0][0]++;
      },
    ];
    for (const mutate of mutations) {
      mutate();
      const delta = replication.snapshot(options).fullEntities.find(record => record.id === rock.id);
      results.push(stringify(delta?.segments) === stringify(rock.segments));
      results.push(!replication.snapshot(options).fullEntities.some(record => record.id === rock.id));
    }
    return [serialized, results];
  } finally { JSON.stringify = stringify; }
}`
          : undefined,
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await replicationBundle.generate({
    format: 'esm',
    minify: true,
  });
  const chunk = output.find((item) => item.type === 'chunk');
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  );

  for (const locked of [false, true]) {
    const [serialized, results] = built.inspectSegments(locked);

    assert(
      results.every(Boolean),
      'production snapshots retain damage, cargo and mutable geometry changes',
    );
    assert.equal(
      serialized,
      0,
      'production must not stringify segment arrays to compare snapshot history',
    );
  }
  console.log(
    'Production snapshots reuse asteroid segment geometry without stringifying it',
  );
} finally {
  await replicationBundle.close();
}
