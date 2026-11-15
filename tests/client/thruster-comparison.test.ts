import assert from 'node:assert/strict';
import { createServer } from 'vite';
import type { Module } from '../../src/client/objects/modules/module';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});

try {
  const { thrusterComparison } = (await server.ssrLoadModule(
    '/src/tools/module-viewer/thruster-comparison.ts',
  )) as typeof import('../../src/tools/module-viewer/thruster-comparison');
  const { createPlayerShip } = (await server.ssrLoadModule(
    '/src/client/objects/create-ship.ts',
  )) as typeof import('../../src/client/objects/create-ship');
  const { thrusters } = (await server.ssrLoadModule(
    '/src/client/objects/modules/index.ts',
  )) as typeof import('../../src/client/objects/modules');
  const { createWorld } = (await server.ssrLoadModule(
    '/src/client/simulation/world.ts',
  )) as typeof import('../../src/client/simulation/world');
  const { shipStats } = (await server.ssrLoadModule(
    '/src/client/ui/dom/ship-stats.ts',
  )) as typeof import('../../src/client/ui/dom/ship-stats');

  const ship = createPlayerShip(createWorld());
  const mount = ship.mounts.find(
    ({ module }) => module && module.behavior === 'thruster',
  );

  assert(mount?.module);
  const stockType = mount.module.constructor;
  const stockStats = shipStats(ship);
  const comparison = thrusterComparison();

  assert.deepEqual(
    comparison.map(({ Type }) => Type.definitionId).sort(),
    thrusters.map(({ definitionId }) => definitionId).sort(),
    'every playable thruster appears once',
  );
  assert.equal(comparison.filter(({ stock }) => stock).length, 1);
  assert.equal(comparison.find(({ stock }) => stock)?.Type, stockType);

  ship.fit(0, mount);

  for (const row of comparison) {
    const expected = shipStats(ship, row.Type);
    const Type = row.Type as typeof Module;

    assert.equal(row.compatible, mount.fits.includes(row.Type));
    assert.equal(row.mass, Type.mass);
    assert.equal(row.price, Type.price);

    for (const key of ['acceleration', 'maxSpeed', 'turnRate'] as const) {
      assert(
        Math.abs(row[key] - expected[key]) < 1e-9,
        `${row.Type.name}: ${key}`,
      );
    }
  }

  const stock = comparison.find(({ stock }) => stock)!;

  for (const key of ['acceleration', 'maxSpeed', 'turnRate'] as const) {
    assert(
      Math.abs(stock[key] - stockStats[key]) < 1e-9,
      `stock Mustang: ${key}`,
    );
  }

  assert(comparison.some(({ compatible }) => compatible));
  assert(comparison.some(({ compatible }) => !compatible));
  assert(comparison.some(({ Type }) => Type.definitionId === 'thrusterTriple'));
} finally {
  await server.close();
}
