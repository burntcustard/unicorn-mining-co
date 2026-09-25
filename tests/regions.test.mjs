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
      export { generateRegion, asteroidSpacing } from '${process.cwd()}/src/shared/simulation/region-generation.ts';
      export { RegionManager } from '${process.cwd()}/src/shared/simulation/region-manager.ts';
      export { RegionManager as ServerRegionManager } from '${process.cwd()}/src/server/region-manager.ts';
      export { createWorld } from '${process.cwd()}/src/shared/simulation/world.ts';
      export { Vector } from '${process.cwd()}/src/shared/vector.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'regions' ? '\0regions' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });
const {
  createWorld,
  generateRegion,
  asteroidSpacing,
  RegionManager,
  ServerRegionManager,
  Vector,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

assert.equal(asteroidSpacing, 30);
const options = { worldSeed: 25, region: Vector(5, 8) };
const first = generateRegion(options);

generateRegion({ worldSeed: 25, region: Vector(4, 8) });
assert.deepEqual(generateRegion(options), first);
assert.notDeepEqual(
  generateRegion({ worldSeed: 26, region: Vector(5, 8) }),
  first,
);

const nearbyDescriptions = [4, 5, 6].flatMap((x) =>
  [-1, 0, 1].map((y) =>
    generateRegion({ worldSeed: 25, region: Vector(x, y) }),
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
        asteroid.position.distanceTo(other.position) >=
          asteroid.radius + other.radius + asteroidSpacing,
        `generated asteroids ${asteroid.id} and ${other.id} have room to move`,
      ),
    );
  nearbyObstacles.forEach((other) =>
    assert(
      asteroid.position.distanceTo(other.position) >=
        asteroid.radius + other.radius + asteroidSpacing,
      `generated asteroid ${asteroid.id} clears station or wreck ${other.id}`,
    ),
  );
});

const manager = new RegionManager({ worldSeed: 25 });
const loaded = manager.load({ region: Vector(5, 8) });

loaded.description.asteroids[0].radius = 321;
manager.unload({ region: Vector(5, 8) });
assert.equal(
  manager.load({ region: Vector(5, 8) }).description.asteroids[0].radius,
  321,
);
const removedId = manager.load({ region: Vector(5, 8) }).description
  .asteroids[0].id;

manager.remove({ id: removedId });
manager.unload({ region: Vector(5, 8) });
assert.equal(
  manager
    .load({ region: Vector(5, 8) })
    .description.asteroids.some(({ id }) => id === removedId),
  false,
);

const position = Vector();
const view = manager.query({ position });

assert.ok(manager.loadedRegionCount <= 121);
assert.ok(view.asteroids.length > 0);
assert.ok(view.stationMarkers.length > 0);
assert.ok(
  view.asteroids.every(({ position: at }) => at.distanceTo(position) <= 2000),
);
assert.ok(
  view.stations.every(({ position: at }) => at.distanceTo(position) <= 2000),
);
assert.ok(
  view.stationMarkers.every(
    ({ position: at }) => at.distanceTo(position) <= 10000,
  ),
);
assert.ok(view.stationMarkers.length > view.stations.length);

const spread = new RegionManager({ worldSeed: 25 });
const spreadPositions = [Vector(), Vector(30000, 0)];
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
  242,
  'both distant players retain their regions',
);
spread.queryMany({ positions: [spreadPositions[0]] });
assert.equal(
  spread.loadedRegionCount,
  121,
  'regions unload after their last player leaves',
);

const serverRegions = new ServerRegionManager({ worldSeed: 25 });
const world = createWorld({ seed: 25 });

serverRegions.sync({ positions: [position], world });
const distantStation = [...world.entities.values()].find(
  (entity) =>
    entity.kind === 'station' && entity.position.distanceTo(position) > 2000,
);

assert(distantStation, 'off-screen stations are materialised');
distantStation.rotation = 1.234;
const regionalAsteroid = [...world.entities.values()].find(
  ({ kind }) => kind === 'asteroid',
);

assert(regionalAsteroid);
const fragments = regionalAsteroid.detach({
  asteroidSegment: regionalAsteroid.segments[0],
  world,
});

serverRegions.sync({ positions: [position], world });
serverRegions.sync({ positions: [position], world });
assert.equal(world.entities.has(regionalAsteroid.id), false);
assert.equal(
  fragments.every(({ id }) => world.entities.has(id)),
  true,
);
assert.equal(
  serverRegions
    .view({ position })
    .asteroids.some(({ id }) => id === regionalAsteroid.id),
  false,
);

serverRegions.sync({ positions: [Vector(50000, 50000)], world });
assert(
  !world.entities.has(distantStation.id),
  'unloaded stations leave simulation',
);
assert(
  fragments.every(({ id }) => !world.entities.has(id)),
  'distant fragments stop participating in physics',
);
serverRegions.sync({ positions: [position], world });
assert.equal(
  world.entities.get(distantStation.id),
  distantStation,
  'station state survives unloading',
);
assert.equal(
  distantStation.rotation,
  1.234,
  'unloaded stations do not advance',
);
assert(
  fragments.every((fragment) => world.entities.get(fragment.id) === fragment),
  'returning restores fragment identity and damaged state',
);
assert.equal(
  world.entities.has(regionalAsteroid.id),
  false,
  'sleeping fragments do not resurrect their source',
);

// Both players can see the same procedural source in one regional sync.
// Splitting it must remove that source only once, before any view can load it
// again over the fragments.
const sharedRegions = new ServerRegionManager({ worldSeed: 25 });
const sharedWorld = createWorld({ seed: 25 });
const sharedPositions = [Vector(2500, 1200), Vector(2600, 1200)];

sharedRegions.sync({ positions: sharedPositions, world: sharedWorld });
const sharedSource = [...sharedWorld.entities.values()].find(
  (entity) =>
    entity.kind === 'asteroid' &&
    sharedPositions.every(
      (position) => entity.position.distanceTo(position) < 2500,
    ),
);

assert(sharedSource, 'both players can reach the starter asteroid');
const sharedChildren = sharedSource.detach({
  asteroidSegment: sharedSource.segments[0],
  world: sharedWorld,
});

sharedRegions.sync({ positions: sharedPositions, world: sharedWorld });
assert.equal(
  sharedWorld.entities.has(sharedSource.id),
  false,
  'a second player view cannot resurrect a fractured asteroid',
);
assert(
  Math.abs(
    sharedChildren.reduce((mass, child) => mass + child.mass, 0) -
      sharedSource.mass,
  ) < 1e-8,
  'the fragments contain the source mass exactly once',
);

console.log(
  `Regional view: ${view.asteroids.length} full asteroids within 2 km, ` +
    `${view.stationMarkers.length} station markers within 10 km, ` +
    `${view.stations.length} stations within physics range.`,
);
