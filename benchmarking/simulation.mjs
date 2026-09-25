import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { rolldown } from 'rolldown';
import { resolve } from 'node:path';

const bundle = await rolldown({
  input: 'simulation-benchmark',
  plugins: [
    {
      name: 'simulation-benchmark',
      resolveId: (id) =>
        id === 'simulation-benchmark' ? '\0simulation-benchmark' : undefined,
      load: (id) =>
        id === '\0simulation-benchmark'
          ? `
      export { createWorld, addEntity, addPlayer } from '${resolve('src/shared/simulation/world.ts')}';
      export { createShip } from '${resolve('src/shared/craft/create-ship.ts')}';
      export { captureWorld } from '${resolve('src/shared/simulation/world-state.ts')}';
      export { updateWorld } from '${resolve('src/shared/simulation/update-world.ts')}';
      export {Vector} from '${resolve('src/shared/vector.ts')}';
      export {RegionManager as ServerRegions} from '${resolve('src/server/region-manager.ts')}';
    `
          : undefined,
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const {
  createWorld,
  createShip,
  addEntity,
  addPlayer,
  captureWorld,
  updateWorld,
  ServerRegions,
  Vector,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const setup = () => {
  const world = createWorld({ seed: 25 });
  const regions = new ServerRegions({ worldSeed: 25 });
  const station = regions
    .view({ position: Vector() })
    .stationMarkers.sort(
      (a, b) => a.position.length() - b.position.length(),
    )[0];
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 1,
      position: station.position.add(Vector(700)),
    }),
  );

  addPlayer(world, { id: 1, shipId: ship.id });
  regions.sync({ world, positions: [ship.position] });
  return world;
};
const measure = ({ name, run }) => {
  const world = setup();

  for (let i = 0; i < 120; i++) run(world);
  const samples = [];

  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();

    for (let i = 0; i < 300; i++) run(world);
    samples.push((performance.now() - start) / 300);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name,
      entities: world.entities.size,
      medianMs: samples[3],
      worstBatchMs: samples.at(-1),
    }),
  );
};

measure({
  name: 'shared simulation tick',
  run: (world) => updateWorld({ world: world, inputs: new Map() }),
});
measure({ name: 'rollback capture', run: (world) => captureWorld({ world }) });
measure({
  name: 'predicted tick with capture',
  run: (world) => {
    captureWorld({ world });
    updateWorld({ world: world, inputs: new Map() });
  },
});
