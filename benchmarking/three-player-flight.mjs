/* global process */
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) =>
      arg.includes('=')
        ? arg.replace(/^--/, '').split('=')
        : [arg.replace(/^--/, ''), true],
    ),
);
const playerCount = Number(options.players || 3);

if (![1, 2, 3].includes(playerCount)) {
  throw new Error('--players must be 1, 2 or 3');
}
const directory = await mkdtemp(join(tmpdir(), 'unicorn-three-player-'));
const entry = options.bundle || join(directory, 'session.mjs');

if (!options.bundle) {
  const bundle = await rolldown({
    input: 'session-entry',
    platform: 'node',
    plugins: [
      {
        name: 'entry',
        resolveId(id) {
          if (id === 'session-entry') return '\0session-entry';

          if (id === 'ws') {
            return {
              id: resolve('node_modules/ws/wrapper.mjs'),
              external: true,
            };
          }
        },
        load(id) {
          if (id === '\0session-entry') {
            return `
      export { GameSession } from '${resolve('src/server/game-session.ts')}';
      export { RegionManager } from '${resolve('src/server/region-manager.ts')}';
      export { ReplicationManager } from '${resolve('src/server/replication.ts')}';
      export { GameCollisions } from '${resolve('src/shared/collision/game-collisions.ts')}';
      export { World } from '${resolve('src/shared/physics/world.ts')}';
    `;
          }
        },
      },
    ],
  });

  await bundle.write({ file: options.save || entry, format: 'esm' });
  await bundle.close();
}

try {
  const api = await import(pathToFileURL(options.save || entry));
  // A broad-phase replacement can otherwise change collision order and hence
  // the flight path/density being benchmarked. Normalize candidate order on
  // both implementations for a matched-workload comparison.

  if (options['ordered-pairs']) {
    const original = api.World.prototype.findNewContacts;
    const installed = new WeakSet();

    api.World.prototype.findNewContacts = function () {
      const broad = this.m_broadPhase;
      const tree = broad.m_tree || broad.m_grid;
      const bodyOf = (node) => {
        const data = tree.getUserData ? tree.getUserData(node) : node.userData;

        return (data.fixture || data).m_body;
      };

      if (!installed.has(tree)) {
        const query = tree.query;

        tree.query = function (bounds, callback, ...rest) {
          const owner = bodyOf(broad.m_queryProxyId || broad.m_queryProxy);
          const candidates = [];

          query.call(
            this,
            bounds,
            (node) => {
              if (bodyOf(node) !== owner) candidates.push(node);
              return true;
            },
            ...rest,
          );
          candidates.sort(
            (a, b) =>
              (typeof a === 'number' ? a : a.id) -
              (typeof b === 'number' ? b : b.id),
          );

          for (const node of candidates) if (callback(node) === false) break;
        };
        installed.add(tree);
      }
      return original.call(this);
    };
  }
  const costs = {};

  if (options.profile !== undefined) {
    for (const [name, key] of [
      ['RegionManager', 'sync'],
      ['ReplicationManager', 'snapshot'],
      ['GameCollisions', 'sync'],
      ['World', 'step'],
    ]) {
      const original = api[name].prototype[key];

      api[name].prototype[key] = function (...args) {
        const t = performance.now();

        try {
          return original.apply(this, args);
        } finally {
          const k = name + '.' + key;

          costs[k] = (costs[k] || 0) + performance.now() - t;
        }
      };
    }
  }
  const scenarios = [
    {
      name: 'convoy',
      positions: [
        [-3727, -8190],
        [-3427, -8190],
        [-3127, -8190],
      ],
      rotations: [-1.5, -1.5, -1.5],
    },
    {
      name: 'spread',
      positions: [
        [-3727, -8190],
        [-8650, -19969],
        [4500, 6500],
      ],
      rotations: [-1.5, 0.3, 2],
    },
    {
      name: 'contact',
      positions: [
        [-3814, -10013],
        [-3614, -9813],
        [-3414, -9613],
      ],
      rotations: [-1.713, -1.713, -1.713],
    },
  ];

  const selected = scenarios.filter(
    (s) => !options.scenario || s.name === options.scenario,
  );
  const runs = options.warm ? [...selected, ...selected] : selected;

  for (const [run, scenario] of runs.entries()) {
    const session = new api.GameSession({ worldSeed: 25 });
    const hash = createHash('sha256');
    let recording = false,
      bytes = 0,
      packets = 0;
    const sockets = Array.from({ length: playerCount }, () => ({
      readyState: 1,
      bufferedAmount: 0,
      send(packet) {
        if (recording) {
          hash.update(packet);
          bytes += packet.length;
          packets++;
        }
      },
      close() {},
      terminate() {},
    }));

    sockets.forEach((socket) =>
      session.receive({
        message: { type: 'hello', playerToken: null },
        socket,
      }),
    );
    const players = [...session.players.values()];

    players.forEach((p, i) => {
      [p.ship.position.x, p.ship.position.y] = scenario.positions[i];
      p.ship.rotation = scenario.rotations[i];
    });
    const sequences = [0, 0, 0];
    const steer = (tick) =>
      players.forEach((p, i) => {
        const phase = (tick + i * 100) % 600;
        const input = {
          ...p.lastInput,
          thrust: 1,
          turn: phase < 20 ? (Math.floor(tick / 600) % 2 ? 1 : -1) : 0,
        };

        if (tick === 0 || input.turn !== p.lastInput.turn) {
          session.receive({
            socket: sockets[i],
            message: {
              type: 'input',
              tick: session.world.tick,
              sequence: ++sequences[i],
              input,
            },
          });
        }
      });

    for (let tick = 0; tick < 300; tick++) {
      steer(tick);
      session.tick();
    }
    recording = true;
    const ticks = Number(options.ticks || 9000),
      cpu = process.cpuUsage(),
      started = performance.now(),
      samples = [];
    let maxEntities = 0;

    for (const key in costs) costs[key] = 0;

    for (let tick = 0; tick < ticks; tick++) {
      steer(tick + 300);
      const start = performance.now();

      session.tick();
      samples.push(performance.now() - start);
      maxEntities = Math.max(maxEntities, session.world.entities.size);
    }
    const elapsed = performance.now() - started,
      used = process.cpuUsage(cpu);

    samples.sort((a, b) => a - b);

    if (options.warm && run < selected.length) continue;
    console.log(
      JSON.stringify({
        warmed: Boolean(options.warm),
        scenario: scenario.name,
        ticks,
        players: playerCount,
        heapMiB: process.memoryUsage().heapUsed / 2 ** 20,
        rssMiB: process.memoryUsage().rss / 2 ** 20,
        wallMs: elapsed / ticks,
        cpuMs: (used.user + used.system) / 1000 / ticks,
        p50: samples[Math.floor(ticks * 0.5)],
        p95: samples[Math.floor(ticks * 0.95)],
        max: samples.at(-1),
        entities: session.world.entities.size,
        maxEntities,
        positions: players.map((p) => ({ ...p.ship.position })),
        packets,
        bytes,
        hash: hash.digest('hex'),
        costs: Object.fromEntries(
          Object.entries(costs).map(([k, v]) => [k, v / ticks]),
        ),
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
