/* global process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.slice(2).split('=')),
);
const directory = await mkdtemp(join(tmpdir(), 'network-routing-'));
const entry = join(directory, 'session.mjs');
const baseline = new Map();

if (options['network-baseline']) {
  for (const name of ['game-session.ts', 'replication.ts']) {
    baseline.set(
      resolve('src/server', name),
      await readFile(join(options['network-baseline'], name), 'utf8'),
    );
  }
}

try {
  const bundle = await rolldown({
    input: resolve('src/server/game-session.ts'),
    platform: 'node',
    plugins: [
      {
        name: 'network-baseline',
        resolveId(id) {
          if (id === 'ws') {
            return {
              id: resolve('node_modules/ws/wrapper.mjs'),
              external: true,
            };
          }
        },
        transform(code, id) {
          return baseline.get(id) ?? code;
        },
      },
    ],
  });

  await bundle.write({ file: entry, format: 'esm' });
  await bundle.close();
  const { GameSession } = await import(pathToFileURL(entry));
  const session = new GameSession({ worldSeed: 25 });
  const sockets = Array.from({ length: 40 }, () => ({
    readyState: 1,
    bufferedAmount: 0,
    send() {},
    close() {},
    terminate() {},
  }));

  for (const socket of sockets) {
    session.receive({ socket, message: { type: 'hello', playerToken: null } });
  }
  const players = [...session.players.values()];
  const messages = sockets.map((socket) => ({
    socket,
    message: { type: 'snapshotAck', sequence: 1 },
  }));
  const iterations = Number(options.iterations || 300000);

  assert(Number.isInteger(iterations) && iterations > 0);

  for (const retained of [0, 400, 4000]) {
    // These disconnected identities model the 30-minute reconnect cache.
    // Install them before active records to exercise the full retained lookup.
    session.players = new Map(
      Array.from({ length: retained }, (_, id) => [
        'retained-' + id,
        { socket: undefined },
      ]),
    );

    for (const player of players) session.players.set(player.token, player);

    for (let i = 0; i < 50000; i++) {
      session.receive(messages[i % sockets.length]);
    }
    const samples = [];

    for (let repeat = 0; repeat < 5; repeat++) {
      const started = process.cpuUsage();
      const wall = performance.now();

      for (let i = 0; i < iterations; i++) {
        session.receive(messages[i % sockets.length]);
      }
      const elapsed = performance.now() - wall;
      const cpu = process.cpuUsage(started);

      samples.push({
        cpuNs: ((cpu.user + cpu.system) * 1000) / iterations,
        wallNs: (elapsed * 1e6) / iterations,
      });
    }
    // Exercise an acknowledgement that actually frees the receiver window.
    players[0].pendingSnapshots = [1, 2];
    session.receive(messages[0]);
    assert.deepEqual(players[0].pendingSnapshots, [2]);
    console.log(
      JSON.stringify({
        production: false,
        active: sockets.length,
        retained,
        iterations,
        samples,
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
