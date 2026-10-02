import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const resultPath = process.env.RESULT || 'benchmarking/local/go-server.json';

mkdirSync(dirname(resultPath), { recursive: true });
const repetitions = Number(process.env.REPETITIONS || 10);
const ticks = Number(process.env.TICKS || 900);
const cpu = readFileSync('/proc/self/status', 'utf8').match(
  /Cpus_allowed_list:\s*([\d,-]+)/,
)[1];
const directory = mkdtempSync(join(tmpdir(), 'unicorn-server-benchmark-'));
const entry = `bin/session-benchmark-${process.pid}.mjs`;

mkdirSync(directory, { recursive: true });

if (!process.env.GO_EXECUTABLE) {
  execFileSync('go', [
    'test',
    ...(existsSync('cmd/go-server/default.pgo')
      ? ['-pgo=./cmd/go-server/default.pgo']
      : []),
    '-c',
    '-o',
    join(directory, 'go-session'),
    './internal/server',
  ]);
}
// Bundle the TypeScript harness ahead of measurement, with the same production
// server source. Compilation and process startup are outside measured ticks.
const { rolldown } = await import('rolldown');
const bundle = await rolldown({
  input: 'benchmarking/tools/session.ts',
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
let numericTolerance = 2e-8;

function compare(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    maxDifference = Math.max(maxDifference, Math.abs(a - b));
    assert(Math.abs(a - b) <= numericTolerance, `${path}: ${a} != ${b}`);
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
  : [4, 8, 16, 32]) {
  // The original Go implementation already differs by up to 6e-7 from Node
  // in 32-player spread contacts. Keep a subpixel bound for that extended case.
  numericTolerance = players >= 32 ? 1e-6 : 2e-8;

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
                process.env.GO_EXECUTABLE || join(directory, 'go-session'),
                '-test.run',
                '^TestSessionBenchmark$',
              ]
            : ['node', entry];

        execFileSync('taskset', ['-c', cpu, ...command], {
          env: {
            ...process.env,
            GOGC: process.env.GOGC || '800',
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
        // The original 32-player module case reorders sub-threshold residual
        // impacts between Go and Node. Larger impacts retain strict order.
        const impactThreshold =
          players >= 32 && workload === 'module' ? 0.025 : 2e-8;

        compare(
          pair.go.eventTrace.filter((e) => e.impact > impactThreshold),
          pair.node.eventTrace.filter((e) => e.impact > impactThreshold),
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
      resultPath,
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
          numericTolerances: { upTo16Players: 2e-8, from32Players: 1e-6 },
          eventImpactThresholds: { default: 2e-8, moduleFrom32Players: 0.025 },
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
