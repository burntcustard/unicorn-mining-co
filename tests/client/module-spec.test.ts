import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin } from '../../plugins/build-plugins';
import { moduleSpecForSimulation } from '../../src/client/utilities/module-spec';
import type { ModuleSpec } from '../../src/specs/modules/types';
import type { ModuleId } from '../../src/specs/modules';
import {
  moduleCategories,
  moduleCategoryIds,
} from '../../src/specs/modules/categories';
import { renderingLayers } from '../../src/specs/rendering-layers';

const spec: ModuleSpec = {
  behavior: 'weapon',
  name: 'Timing fixture',
  icon: './autogun.svg',
  description: 'Timing fixture.',
  power: 0.1,
  powerActivated: 1.6,
  health: 10,
  price: 20,
  zIndex: renderingLayers.modulesBelowShipHull,
  activationDuration: 125.5,
  chargeDuration: 0,
  dischargeDuration: 300,
  rechargeDuration: 700,
  coverDuration: 200,
  fireInterval: 1000 * (1 / 30),
  damage: 4,
  barrelLength: 10,
  muzzleFlash: [
    { type: 'glow', color: '#fff', radius: 3, duration: 120, delay: 40 },
  ],
  projectile: {
    speed: 400,
    lifetime: 1500,
    fadeOut: 200,
    radius: 2,
    color: '#fff',
  },
  model: [
    {
      outline: true,
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      rechargeDelay: 0.75,
    },
  ],
};

const before = structuredClone(spec);
const runtime = moduleSpecForSimulation(spec);

assert.equal(runtime.activationDuration, 0.1255);
assert.equal(runtime.chargeDuration, 0);
assert.equal(runtime.dischargeDuration, 0.3);
assert.equal(runtime.rechargeDuration, 0.7);
assert.equal(runtime.coverDuration, 0.2);
assert.equal(runtime.fireInterval, 1 / 30);
assert.equal(runtime.projectile?.lifetime, 1.5);
assert.equal(runtime.model[0].rechargeDelay, 0.00075);
assert.equal(runtime.projectile?.fadeOut, 200);
assert.equal(runtime.projectile?.speed, 400);
assert.equal(runtime.muzzleFlash, spec.muzzleFlash);
assert.deepEqual(
  spec,
  before,
  'runtime conversion must not change authored milliseconds',
);
assert.notEqual(runtime.projectile, spec.projectile);
assert.notEqual(runtime.model[0], spec.model[0]);

const optional = { ...spec };

delete optional.chargeDuration;
assert.equal(moduleSpecForSimulation(optional).chargeDuration, undefined);

const { moduleIds, moduleSpecList, moduleSpecs } =
  await import('../../src/specs/modules');

assert.deepEqual(
  moduleSpecList,
  moduleIds.map((id) => moduleSpecs[id]),
);

const discoveredIds: string[] = [];

for (const category of moduleCategoryIds) {
  const folder = new URL(
    `../../src/specs/modules/${category}/`,
    import.meta.url,
  );

  for (const file of readdirSync(folder).filter(
    (file) =>
      file.endsWith('.ts') &&
      file !== 'index.ts' &&
      !file.startsWith('example-'),
  )) {
    const exports = await import(new URL(file, folder).href);

    for (const [id, authored] of Object.entries(exports)) {
      if (!authored || typeof authored !== 'object' || !('power' in authored)) {
        continue;
      }

      discoveredIds.push(id);
      assert.deepEqual(
        moduleSpecs[id as ModuleId],
        { ...authored, category },
        `${file} must be registered in its folder's category`,
      );
    }
  }
}

assert.deepEqual(discoveredIds.sort(), [...moduleIds].sort());

const categoryEntry = resolve('src/__module_categories_test.ts');

const categoryBundle = await rolldown({
  input: categoryEntry,
  plugins: [
    {
      name: 'module-category-fixture',
      resolveId: (id) => (id === categoryEntry ? id : undefined),
      load: (id) =>
        id === categoryEntry
          ? `import { moduleSpecList } from './specs/modules';
import { moduleCategories } from './specs/modules/categories';
export function inspectCategories() {
  return moduleSpecList.map(spec => {
    const metadata = moduleCategories.get(spec.category);
    return [spec.category, metadata.name, metadata.color];
  });
}`
          : undefined,
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await categoryBundle.generate({
    format: 'esm',
    minify: true,
  });

  const chunk = output.find((item) => item.type === 'chunk');

  assert(chunk);

  const built = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  );

  assert.deepEqual(
    built.inspectCategories(),
    moduleSpecList.map((spec) => {
      const metadata = moduleCategories.get(spec.category)!;

      return [spec.category, metadata.name, metadata.color];
    }),
    'folder categories and UI metadata must agree after production mangling',
  );
} finally {
  await categoryBundle.close();
}

for (const module of moduleSpecList) {
  assert(Number.isFinite(module.power) && module.power >= 0);
  assert(
    Number.isFinite(module.powerActivated) &&
      module.powerActivated >= module.power,
  );
}

assert(moduleSpecs.powerPlant.powerGenerated > 0);
