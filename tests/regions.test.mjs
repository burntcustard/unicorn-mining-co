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
      export { generateRegion } from '${process.cwd()}/src/shared/simulation/region-generation.ts';
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
  RegionManager,
  ServerRegionManager,
  Vector,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const options = { worldSeed: 25, region: Vector(5, 8) };
const first = generateRegion(options);

generateRegion({ worldSeed: 25, region: Vector(4, 8) });
assert.deepEqual(generateRegion(options), first);
assert.notDeepEqual(
  generateRegion({ worldSeed: 26, region: Vector(5, 8) }),
  first,
);

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
  section: regionalAsteroid.sections[0],
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
  'returning restores fragment identity and mined state',
);
assert.equal(
  world.entities.has(regionalAsteroid.id),
  false,
  'sleeping fragments do not resurrect their source',
);

console.log(
  `Regional view: ${view.asteroids.length} full asteroids within 2 km, ` +
    `${view.stationMarkers.length} station markers within 10 km, ` +
    `${view.stations.length} stations within physics range.`,
);
