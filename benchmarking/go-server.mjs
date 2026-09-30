import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repetitions = Number(process.env.REPETITIONS || 10);
const ticks = Number(process.env.TICKS || 900);
const cpu = readFileSync('/proc/self/status', 'utf8').match(
  /Cpus_allowed_list:\s*(\d+)/,
)[1];
const directory = mkdtempSync(join(tmpdir(), 'unicorn-server-benchmark-'));
const entry = `bin/session-benchmark-${process.pid}.mjs`;

mkdirSync(directory, { recursive: true });
execFileSync('go', [
  'test',
  '-c',
  '-o',
  join(directory, 'go-session'),
  './internal/server',
]);
// Bundle the TypeScript harness ahead of measurement, with the same production
// server source. Compilation and process startup are outside measured ticks.
const { rolldown } = await import('rolldown');
const bundle = await rolldown({
  input: 'benchmarking/session.ts',
  external: ['ws', /^node:/],
  platform: 'node',
});

await bundle.write({ file: entry, format: 'esm' });
await bundle.close();
const decoder = await rolldown({
  input: 'src/shared/protocol/binary-snapshot.ts',
});
const { output } = await decoder.generate({ format: 'esm' });

await decoder.close();
const { decodeBinarySnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
let maxDifference = 0;

function compare(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    maxDifference = Math.max(maxDifference, Math.abs(a - b));
    assert(Math.abs(a - b) <= 2e-8, `${path}: ${a} != ${b}`);
    return;
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(
      Object.keys(a).sort(),
      Object.keys(b).sort(),
      `${path} keys`,
    );

    for (const key of Object.keys(a)) compare(a[key], b[key], `${path}.${key}`);
  } else assert.deepEqual(a, b, path);
}
const results = [];

for (const players of process.env.PLAYERS
  ? [Number(process.env.PLAYERS)]
  : [4, 8, 16]) {
  for (const workload of process.env.WORKLOAD
    ? [process.env.WORKLOAD]
    : ['convoy', 'spread', 'contact', 'module']) {
    for (let repetition = -1; repetition < repetitions; repetition++) {
      const pair = {};
      // Alternate execution order to avoid consistently favouring a warm second run.

      for (const runtime of repetition % 2 ? ['go', 'node'] : ['node', 'go']) {
        const file = join(directory, `${runtime}.json`);
        const command =
          runtime === 'go'
            ? [
                join(directory, 'go-session'),
                '-test.run',
                '^TestSessionBenchmark$',
              ]
            : ['node', entry];

        execFileSync('taskset', ['-c', cpu, ...command], {
          env: {
            ...process.env,
            GOMAXPROCS: '1',
            SESSION_PLAYERS: String(players),
            SESSION_WORKLOAD: workload,
            SESSION_TICKS: String(ticks),
            SESSION_TRACE: repetition === -1 ? '1' : '',
            SESSION_RESULT: file,
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        pair[runtime] = JSON.parse(readFileSync(file, 'utf8'));
      }

      if (repetition === -1) {
        compare(
          pair.go.eventTrace.filter((e) => e.impact > 2e-8),
          pair.node.eventTrace.filter((e) => e.impact > 2e-8),
          `${players}/${workload}/collision events`,
        );
        assert.equal(pair.go.traces.length, pair.node.traces.length);
        pair.go.traces.forEach((packets, player) => {
          assert.equal(packets.length, pair.node.traces[player].length);
          packets.forEach((packet, index) =>
            compare(
              decodeBinarySnapshot(Buffer.from(packet, 'hex')),
              decodeBinarySnapshot(
                Buffer.from(pair.node.traces[player][index], 'hex'),
              ),
              `${players}/${workload}/player${player}/packet${index}`,
            ),
          );
        });
      }

      for (const field of [
        'contacts',
        'events',
        'packets',
        'entities',
        'states',
      ]) {
        compare(
          pair.go[field],
          pair.node[field],
          `${players}/${workload}/${repetition}/${field}`,
        );
      }

      if (repetition === -1) continue;

      for (const value of Object.values(pair)) {
        delete value.traces;
        delete value.states;
        delete value.eventTrace;
        delete value.contactTrace;
        results.push({ ...value, repetition });
      }
    }
    console.log(
      `${players} players / ${workload}: ${repetitions} paired runs passed`,
    );
    writeFileSync(
      'benchmarking/go-server-results.json',
      JSON.stringify(
        {
          cpu,
          processor: readFileSync('/proc/cpuinfo', 'utf8').match(
            /model name\s*:\s*(.*)/,
          )?.[1],
          node: process.version,
          go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(),
          ticks,
          repetitions,
          maxDifference,
          date: new Date().toISOString(),
          results,
        },
        null,
        2,
      ) + '\n',
    );
  }
}
console.log(`Maximum numeric difference: ${maxDifference}`);

rmSync(entry);
rmSync(directory, { recursive: true, force: true });
