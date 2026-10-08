import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { rolldown } from 'rolldown';
import { buildPlugin, viteBackground } from '../../plugins/build-plugins.ts';
import { replacePreTerser } from '../../plugins/replace-pre-terser.ts';

const pathSource = `import '../shape-distance'; export * from "../../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { distance: 1 }; state.distance = -distance;`;

assert.equal(
  replacePreTerser(pathSource),
  `import '../shape-distance'; export * from "../../distance-shape"; export function distance() {} const value = Vec.distance(a, b); const state = { _distance: 1 }; state._distance = -_distance;`,
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
  const { run } = await import(
    pathToFileURL(join(directory, 'entry.mjs')).href
  );

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
          ? `import { defaultKeybindings, moduleBinding, updateMovement } from './client/input/keybindings';
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
          return `import { initKeys, playerInput } from './client/input/input';
import { emptyPlayerInput, packPlayerInput, unpackPlayerInput } from './client/protocol/input';
import { moduleControls } from './client/objects/control-ship';
export function pressModuleKeys() {
  globalThis.window = new EventTarget();
  const stop = initKeys();
  for (const key of ['d', 'h', 'l', 's', 'p', 'a', 'b']) {
    window.dispatchEvent(Object.assign(new Event('keydown'), { key, repeat: false }));
    window.dispatchEvent(Object.assign(new Event('keyup'), { key }));
  }
  const inspect = () => {
    const bits = packPlayerInput(playerInput);
    return [bits, moduleControls.map(({ readInput }) => readInput(unpackPlayerInput(bits)))];
  };
  const toggled = inspect();
  window.dispatchEvent(Object.assign(new Event('keydown'), { key: ' ', repeat: false }));
  const firing = inspect();
  window.dispatchEvent(Object.assign(new Event('keyup'), { key: ' ' }));
  const released = inspect();
  stop();
  return [toggled, firing, released];
}
export function writeModuleInputs() {
  const input = emptyPlayerInput();
  const restored = moduleControls.map((control) => {
    moduleControls.forEach(({ writeInput }) => writeInput({ input, active: false }));
    control.writeInput({ input, active: true });
    return packPlayerInput(input);
  });
  moduleControls.forEach(({ writeInput }) => writeInput({ input, active: false }));
  return [restored, packPlayerInput(input)];
}`;
        }

        if (id.endsWith('/src/client/audio/sound-loader.ts')) {
          return 'export const unlockAudio = () => {}; export const playSound = () => {};';
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

  assert.deepEqual(built.pressModuleKeys(), [
    [3599, [true, true, true, true, true, true, true]],
    [3855, [true, true, true, true, true, true, true]],
    [3599, [true, true, true, true, true, true, true]],
  ]);
  assert.deepEqual(
    built.writeModuleInputs(),
    [[2048, 512, 1024, 2, 4, 8, 1], 0],
    'restoring and clearing each module input survives production property mangling',
  );
} finally {
  await inputBundle.close();
}

const regionEntry = resolve('src/__mangle_regions.ts');

const regionBundle = await rolldown({
  input: regionEntry,
  plugins: [
    {
      name: 'region-startup-fixture',
      resolveId: (id) => (id === regionEntry ? regionEntry : undefined),
      load: (id) =>
        id === regionEntry
          ? `
        import { RegionManager } from './client/simulation/region-manager';
        import { preGeneratedRadius } from './specs/region-generation';
        export function inspectRegions() {
          const regions = new RegionManager({ worldSeed: 25 });
          regions.preGenerate({ radius: preGeneratedRadius });
          const inactive = regions.loadedRegionCount;
          const first = regions.query({ position: { x: 0, y: 0 } });
          regions.query({ position: { x: 80000, y: -60000 } });
          const returned = regions.query({ position: { x: 0, y: 0 } });
          return [inactive, first.asteroids.length, JSON.stringify(first) === JSON.stringify(returned)];
        }
      `
          : undefined,
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await regionBundle.generate({
    format: 'esm',
    minify: true,
  });

  const built = await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );

  assert.deepEqual(built.inspectRegions(), [0, 36, true]);
} finally {
  await regionBundle.close();
}

// The inline boot renderer is built independently of the mangled main chunk.
const html = await viteBackground().transformIndexHtml.handler(
  await readFile('index.html', 'utf8'),
  {},
);
const boot = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

assert(boot, 'the background must be inlined into the HTML');
let painted = 0;

const context = new Proxy(
  {
    drawImage() {
      painted++;
    },
    createRadialGradient: () => ({ addColorStop() {} }),
  },
  { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
);

const canvas = { style: {}, getContext: () => context };

const browser = createContext({
  canvas,
  innerWidth: 800,
  innerHeight: 600,
  document: { createElement: () => ({ getContext: () => context }) },
  Path2D: class {
    addPath() {}

    arc() {}

    closePath() {}

    lineTo() {}

    moveTo() {}
  },
  createImageBitmap: async (tile: unknown) => tile,
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
    { ...buildPlugin(), generateBundle: undefined },
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
