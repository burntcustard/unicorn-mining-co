/* global Buffer, process */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

assert.equal('window' in globalThis, false);
assert.equal('document' in globalThis, false);

const bundle = await rolldown({
  input: 'regions',
  plugins: [
    {
      name: 'region-test-entry',
      load: (id) =>
        id === '\0regions'
          ? `
      export { generateRegion, generateFields, fieldMessage, asteroidSpacing } from '${process.cwd()}/src/client/simulation/region-generation.ts';
      export { RegionManager } from '${process.cwd()}/src/client/simulation/region-manager.ts';
      export { createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
      export { shapeOutlineOf, createAsteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
      export { preGeneratedRadius } from '${process.cwd()}/src/definitions/region-generation.ts';
      export { message as messageDefinition } from '${process.cwd()}/src/definitions/items/index.ts';
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
  generateFields,
  fieldMessage,
  asteroidSpacing,
  RegionManager,
  Vec,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

assert.equal(asteroidSpacing, 30);
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

// Compare seed 25 against the finite world on main, within its old 50 km radius.
const oldWorldRadius = 50000;
const withinOldWorld = ({ position }) => Vec.length(position) < oldWorldRadius;
const oldWorldFields = generateFields({
  worldSeed: 25,
  from: Vec.create(-oldWorldRadius, -oldWorldRadius),
  to: Vec.create(oldWorldRadius, oldWorldRadius),
}).filter(withinOldWorld);
const distribution = { asteroids: [], stations: [], wrecks: [] };

for (let x = -25; x < 25; x++) {
  for (let y = -25; y < 25; y++) {
    const region = generateRegion({ worldSeed: 25, region: Vec.create(x, y) });

    distribution.asteroids.push(...region.asteroids.filter(withinOldWorld));
    distribution.stations.push(...region.stations.filter(withinOldWorld));
    distribution.wrecks.push(...region.wrecks.filter(withinOldWorld));
  }
}

assert(oldWorldFields.length >= 95 && oldWorldFields.length <= 120);
assert(
  distribution.asteroids.length >= 11000 &&
    distribution.asteroids.length <= 16000,
);
const meanAsteroidRadius =
  distribution.asteroids.reduce((sum, asteroid) => sum + asteroid.radius, 0) /
  distribution.asteroids.length;

assert(meanAsteroidRadius > 105.5 && meanAsteroidRadius < 107);
assert(distribution.asteroids.some(({ spin }) => spin < -0.025));
assert(distribution.asteroids.some(({ spin }) => spin > 0.025));
assert(
  distribution.stations.length >= 13 && distribution.stations.length <= 22,
);
assert(distribution.wrecks.length >= 23 && distribution.wrecks.length <= 35);
assert(oldWorldFields.filter(({ resource }) => resource === 1).length >= 5);
assert(oldWorldFields.filter(({ resource }) => resource === 2).length >= 6);
assert(
  distribution.wrecks.filter(({ paint }) => paint === 1).length >=
    distribution.wrecks.length * 0.55,
);
assert(
  distribution.wrecks.filter(({ paint }) => paint === 1).length <=
    distribution.wrecks.length * 0.8,
);
const richFields = generateFields({
  worldSeed: 25,
  from: Vec.create(-100000, -100000),
  to: Vec.create(100000, 100000),
}).filter(({ resource }) => resource < 3);
const richFieldById = new Map(richFields.map((field) => [field.id, field]));

distribution.wrecks.forEach(({ cargoContents, clueField }) => {
  assert.deepEqual(clueField, richFieldById.get(clueField.id));
  assert(cargoContents.every((resource) => resource === clueField.resource));
  assert.match(
    fieldMessage(clueField),
    /^(AMETHYST CLUSTER|GOLD ORE) -?\d+\/-?\d+$/,
  );
});
