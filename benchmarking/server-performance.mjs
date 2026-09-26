/* global process */

/*
 * Run with node --import tsx benchmarking/server-performance.mjs [--flight].
 * Nested phase times overlap; CPU time includes V8 background work.
 */
import * as Vec from '../src/shared/vector.ts';
import { GameSession } from '../src/server/game-session.ts';
import { RegionManager } from '../src/server/region-manager.ts';
import { ReplicationManager } from '../src/server/replication.ts';
import { GameCollisions } from '../src/shared/collision/game-collisions.ts';
import { World } from '../src/shared/physics/world.ts';

const costs = {};

for (const [Class, key, label] of [
  [RegionManager, 'sync', 'regions'],
  [ReplicationManager, 'snapshot', 'replication'],
  [GameCollisions, 'step', 'collisions'],
  [GameCollisions, 'sync', 'geometry'],
  [World, 'step', 'solver'],
]) {
  const original = Class.prototype[key];

  Class.prototype[key] = function (...args) {
    const start = performance.now();

    try {
      return original.apply(this, args);
    } finally {
      costs[label] = (costs[label] || 0) + performance.now() - start;
    }
  };
}
const cases = process.argv.includes('--flight')
  ? [{ name: 'flight', players: 1, ticks: 18000, flight: true }]
  : [
      { name: 'empty', players: 0 },
      { name: 'spawn', players: 1 },
      { name: 'north', players: 1, north: true },
      { name: 'spawn3', players: 3 },
      { name: 'north3', players: 3, north: true },
    ];

for (const scenario of cases) {
  const session = new GameSession({ worldSeed: 25 });

  for (let p = 0; p < scenario.players; p++) {
    session.receive({
      message: { type: 'hello', playerToken: null },
      socket: {
        readyState: 1,
        bufferedAmount: 0,
        send() {},
        close() {},
        terminate() {},
      },
    });
  }
  const players = [...session.players.values()];

  players.forEach((p, i) => {
    Vec.setXY(
      p.ship.position,
      (scenario.north ? -8650 : -7388) + i * 200,
      (scenario.north ? -19969 : -4398) + i * 200,
    );
  });

  for (let i = 0; i < 100; i++) session.tick();

  for (let block = 0; block < (scenario.ticks || 3000) / 1000; block++) {
    for (const key in costs) costs[key] = 0;
    const cpu = process.cpuUsage(),
      start = performance.now(),
      samples = [];

    for (let i = 0; i < 1000; i++) {
      if (scenario.flight) {
        Vec.setXY(
          players[0].ship.position,
          -8650,
          -4398 - (block * 1000 + i) * 10,
        );
      }
      const t = performance.now();

      session.tick();
      samples.push(performance.now() - t);
    }
    const elapsed = performance.now() - start,
      c = process.cpuUsage(cpu);

    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        name: scenario.name,
        block,
        entities: session.world.entities.size,
        loaded: session.regions.regions.loaded.size,
        saved: session.regions.regions.saved.size,
        sleeping: session.regions.sleeping.size,
        wallPerTick: elapsed / 1000,
        cpuPerTick: (c.user + c.system) / 1e6,
        p50: samples[500],
        p95: samples[950],
        max: samples.at(-1),
        costs: { ...costs },
      }),
    );
  }
}
