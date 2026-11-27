/* global Buffer, process */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'regions',
  plugins: [
    {
      name: 'region-test-entry',
      load: (id) =>
        id === '\0regions'
          ? `
      export { generateRegion, asteroidSpacing } from '${process.cwd()}/src/client/simulation/region-generation.ts';
      export { RegionManager } from '${process.cwd()}/src/client/simulation/region-manager.ts';
      export { createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
      export { shapeOutlineOf, createAsteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
      export { preGeneratedRadius } from '${process.cwd()}/src/specs/region-generation.ts';
      export { message as messageSpec } from '${process.cwd()}/src/specs/items/index.ts';
export { Item } from '${process.cwd()}/src/client/objects/item.ts';
      export * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'regions' ? '\0regions' : undefined),
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

const {
  generateRegion,
  asteroidSpacing,
  RegionManager,
  Vec,
}: {
  generateRegion: typeof import('../../src/client/simulation/region-generation.ts').generateRegion;
  asteroidSpacing: typeof import('../../src/client/simulation/region-generation.ts').asteroidSpacing;
  RegionManager: typeof import('../../src/client/simulation/region-manager.ts').RegionManager;
  createWorld: typeof import('../../src/client/simulation/world.ts').createWorld;
  shapeOutlineOf: typeof import('../../src/client/objects/asteroid.ts').shapeOutlineOf;
  createAsteroid: typeof import('../../src/client/objects/asteroid.ts').createAsteroid;
  preGeneratedRadius: typeof import('../../src/specs/region-generation.ts').preGeneratedRadius;
  messageSpec: typeof import('../../src/specs/items/index.ts').message;
  Item: typeof import('../../src/client/objects/item.ts').Item;
  Vec: typeof import('../../src/client/utilities/vector.ts');
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const options = { worldSeed: 25, region: Vec.create(5, 8) };
const first = generateRegion(options);

assert(
  first.asteroids.every(
    ({ position }) =>
      Number.isInteger(position.x) && Number.isInteger(position.y),
  ),
  'procedural asteroids start at whole-number coordinates',
);
generateRegion({ worldSeed: 25, region: Vec.create(4, 8) });
assert.deepEqual(generateRegion(options), first);
assert.notDeepEqual(
  generateRegion({ worldSeed: 26, region: Vec.create(5, 8) }),
  first,
);

const nearbyDescriptions = [4, 5, 6].flatMap((x) =>
  [-1, 0, 1].map((y) =>
    generateRegion({ worldSeed: 25, region: Vec.create(x, y) }),
  ),
);
const nearbyAsteroids = nearbyDescriptions.flatMap(
  ({ asteroids }) => asteroids,
);
const nearbyObstacles = nearbyDescriptions.flatMap(({ stations, wrecks }) => [
  ...stations,
  ...wrecks,
]);

nearbyAsteroids.forEach((asteroid, index) => {
  nearbyAsteroids
    .slice(index + 1)
    .forEach((other) =>
      assert(
        Vec.distance(asteroid.position, other.position) >=
          asteroid.radius + other.radius + asteroidSpacing,
        `generated asteroids ${asteroid.id} and ${other.id} have room to move`,
      ),
    );
  nearbyObstacles.forEach((other) =>
    assert(
      Vec.distance(asteroid.position, other.position) >=
        asteroid.radius + other.radius + asteroidSpacing,
      `generated asteroid ${asteroid.id} clears station or wreck ${other.id}`,
    ),
  );
});

const manager = new RegionManager({ worldSeed: 25 });
const loaded = manager.load({ region: Vec.create(5, 8) });

loaded.description.asteroids[0].radius = 321;
manager.unload({ region: Vec.create(5, 8) });
assert.equal(
  manager.load({ region: Vec.create(5, 8) }).description.asteroids[0].radius,
  321,
);
const removedId = manager.load({ region: Vec.create(5, 8) }).description
  .asteroids[0].id;

manager.remove({ id: removedId });
manager.unload({ region: Vec.create(5, 8) });
assert.equal(
  manager
    .load({ region: Vec.create(5, 8) })
    .description.asteroids.some(({ id }) => id === removedId),
  false,
);

const position = Vec.create();
const view = manager.query({ position });

assert.ok(manager.loadedRegionCount <= 121);
assert.ok(view.asteroids.length > 0);
assert.ok(view.stationMarkers.length > 0);
assert.ok(
  view.asteroids.every(
    ({ position: at }) => Vec.distance(at, position) <= 2000,
  ),
);
assert.ok(
  view.stations.every(({ position: at }) => Vec.distance(at, position) <= 2000),
);
assert.ok(
  view.stationMarkers.every(
    ({ position: at }) => Vec.distance(at, position) <= 10000,
  ),
);
assert.ok(view.stationMarkers.length > view.stations.length);

const spread = new RegionManager({ worldSeed: 25 });
const spreadPositions = [Vec.create(), Vec.create(30000, 0)];
const spreadViews = spread.queryMany({ positions: spreadPositions });

assert.deepEqual(
  spreadViews[0],
  new RegionManager({ worldSeed: 25 }).query({ position: spreadPositions[0] }),
);
assert.deepEqual(
  spreadViews[1],
  new RegionManager({ worldSeed: 25 }).query({ position: spreadPositions[1] }),
);
assert.equal(
  spread.loadedRegionCount,
  18,
  'both distant players retain nearby detail regions',
);
spread.queryMany({ positions: [spreadPositions[0]] });
assert.equal(
  spread.loadedRegionCount,
  9,
  'detail regions unload after their last player leaves',
);
