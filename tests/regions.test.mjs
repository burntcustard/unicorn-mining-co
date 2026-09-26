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
      export { generateRegion, generateFields, fieldMessage, asteroidSpacing } from '${process.cwd()}/src/shared/simulation/region-generation.ts';
      export { RegionManager } from '${process.cwd()}/src/shared/simulation/region-manager.ts';
      export { RegionManager as ServerRegionManager } from '${process.cwd()}/src/server/region-manager.ts';
      export { createWorld } from '${process.cwd()}/src/shared/simulation/world.ts';
      export { Message } from '${process.cwd()}/src/shared/items/message.ts';
      export { ReplicationManager } from '${process.cwd()}/src/server/replication.ts';
      export * as Vec from '${process.cwd()}/src/shared/vector.ts';
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
  generateFields,
  fieldMessage,
  asteroidSpacing,
  Message,
  ReplicationManager,
  RegionManager,
  ServerRegionManager,
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

const serverRegions = new ServerRegionManager({ worldSeed: 25 });
const world = createWorld({ seed: 25 });

serverRegions.sync({ positions: [position], world });
const distantStation = [...world.entities.values()].find(
  (entity) =>
    entity.kind === 'station' && Vec.distance(entity.position, position) > 2000,
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

serverRegions.sync({ positions: [Vec.create(50000, 50000)], world });
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
const sharedPositions = [Vec.create(2500, 1200), Vec.create(2600, 1200)];

sharedRegions.sync({ positions: sharedPositions, world: sharedWorld });
const sharedSource = [...sharedWorld.entities.values()].find(
  (entity) =>
    entity.kind === 'asteroid' &&
    sharedPositions.every(
      (position) => Vec.distance(entity.position, position) < 2500,
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

const clueWreck = distribution.wrecks[0];
const clueWorld = createWorld({ seed: 25 });
const clueRegions = new ServerRegionManager({ worldSeed: 25 });

clueRegions.sync({ positions: [clueWreck.position], world: clueWorld });
const materializedWreck = clueWorld.entities.get(clueWreck.id);
const slate = materializedWreck?.cargoContents.find(
  (object) => object instanceof Message,
);

assert(slate instanceof Message, 'every wreck carries a clue slate');
assert.equal(slate.message, fieldMessage(clueWreck.clueField));
assert.equal(slate.unlock, 'ORANGE');
const clueLoad = new ReplicationManager().initial({
  world: clueWorld,
  shipId: clueWreck.id,
  position: clueWreck.position,
});
const replicatedWreck = clueLoad.fullEntities.find(
  ({ id }) => id === clueWreck.id,
);

assert(
  replicatedWreck.cargoContents.some(
    ({ message }) => message === fieldMessage(clueWreck.clueField),
  ),
  'the wreck slate reaches a client with its coordinates',
);

distribution.asteroids.forEach(({ contents, radius, resource }) => {
  if (resource === 1) {
    assert(radius >= 100 && radius <= 102);
    assert(contents.every((item) => item === 1));
  } else if (resource === 2) {
    assert(radius >= 160 && radius <= 220);
    assert(contents.every((item) => item === 2));
  } else {
    assert(radius >= 51.25 && radius <= 171.25);
    assert(contents.length <= 6);
  }
});

console.log(
  `Regional view: ${view.asteroids.length} full asteroids within 2 km, ` +
    `${view.stationMarkers.length} station markers within 10 km, ` +
    `${view.stations.length} stations within physics range.`,
);

// Cached region rectangles still filter each new position, range and live edit.
{
  const cached = new RegionManager({ worldSeed: 25 });
  const reference = new RegionManager({ worldSeed: 25 });
  const routes = [
    [Vec.create(-3727, -8190), Vec.create(4500, 6500)],
    [Vec.create(-3690, -8130), Vec.create(4530, 6500)],
    [Vec.create(20000, 20000), Vec.create(-3690, -8130)],
    [Vec.create(-3690, -8130)],
    [],
  ];

  for (const positions of routes) {
    for (const asteroid of [2500, 800]) {
      const ranges = {
        asteroid,
        wreck: 2500,
        stationMarker: 11000,
        stationPhysics: 1000,
      };
      const options = { positions, ranges };
      const expected = reference.queryMany(options);
      // Deliberately invalidate only the reference manager's cached rectangle.

      reference.load({ region: Vec.create(100, 100) });
      reference.unload({ region: Vec.create(100, 100) });
      assert.deepEqual(cached.queryMany(options), expected);
      assert.deepEqual(cached.queryMany(options), reference.queryMany(options));
    }
  }
  const options = { positions: routes[0] };
  const views = cached.queryMany(options);
  const removed = views.flatMap(({ asteroids }) => asteroids)[0];

  assert.ok(removed);
  cached.remove({ id: removed.id });
  reference.remove({ id: removed.id });
  assert.deepEqual(cached.queryMany(options), reference.queryMany(options));
  const loaded = cached.load({ region: Vec.create(100, 100) });

  assert.ok(loaded);
  assert.deepEqual(cached.queryMany(options), reference.queryMany(options));
  assert.equal(cached.loadedRegionCount, reference.loadedRegionCount);
}

// Cached procedural candidates never share mutable descriptions with callers,
// and a different seed must not reuse another world's candidates.
{
  const options = { worldSeed: 25, region: Vec.create(5, 8) };
  const expected = generateRegion(options);
  const edited = generateRegion(options);

  edited.asteroids.forEach((asteroid) => {
    asteroid.position.x += 123;
    asteroid.contents.length = 0;
  });
  edited.stations.length = 0;
  Vec.setXY(edited.region, 999, 999);
  generateRegion({ ...options, worldSeed: 26 });
  assert.deepEqual(generateRegion(options), expected);
}

// Marker-only generation must match a full regional scan, including negative
// coordinates and region boundaries, while loading only nearby detail regions.
for (const position of [Vec.create(), Vec.create(-1999, 2001)]) {
  const manager = new RegionManager({ worldSeed: 25 });
  const expected = [];

  for (
    let x = Math.floor((position.x - 10000) / 2000);
    x <= Math.floor((position.x + 10000) / 2000);
    x++
  ) {
    for (
      let y = Math.floor((position.y - 10000) / 2000);
      y <= Math.floor((position.y + 10000) / 2000);
      y++
    ) {
      expected.push(
        ...generateRegion({ worldSeed: 25, region: Vec.create(x, y) }).stations,
      );
    }
  }
  const markers = expected.filter(
    (station) => Vec.distanceSquared(position, station.position) <= 10000 ** 2,
  );

  assert.deepEqual(manager.query({ position }).stationMarkers, markers);
  assert(manager.loadedRegionCount <= 9);
  const removed = markers[0];

  assert(removed);
  manager.remove({ id: removed.id });
  manager.query({ position: Vec.create(40000, -40000) });
  assert.deepEqual(
    manager.query({ position }).stationMarkers,
    markers.filter(({ id }) => id !== removed.id),
  );
}

// Marker generation must retain edits made through loaded region state.
{
  const manager = new RegionManager({ worldSeed: 25 });
  const marker = manager.query({ position: Vec.create() }).stationMarkers[0];
  const region = Vec.create(
    Math.floor(marker.position.x / 2000),
    Math.floor(marker.position.y / 2000),
  );
  const state = manager.load({ region }).description;
  const station = state.stations.find(({ id }) => id === marker.id);

  station.radius += 10;
  manager.unload({ region });
  assert.equal(
    manager
      .query({ position: Vec.create() })
      .stationMarkers.find(({ id }) => id === marker.id).radius,
    station.radius,
  );
}
