// Compare servers in rotating order, with one shared latest-Go sample
// set. Original Go intentionally uses its original gameplay and rounding rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [original, latest] = process.argv.slice(2);

assert(
  original && latest,
  'Usage: node benchmarking/go-cpu-comparison.mjs ORIGINAL LATEST',
);
const directory = mkdtempSync(join(tmpdir(), 'unicorn-cpu-comparison-'));
const entry = `bin/session-comparison-${process.pid}.mjs`;
const cpu = readFileSync('/proc/self/status', 'utf8').match(
  /Cpus_allowed_list:\s*(\d+)/,
)[1];
const ticks = Number(process.env.TICKS || 900);
const repetitions = Number(process.env.REPETITIONS || 7);
const result =
  process.env.RESULT ||
  'benchmarking/results/2026-10-01-cpu-followup-final.json';
const variants = {
  original: { executable: original, GOGC: '100' },
  latest: { executable: latest, GOGC: '800' },
  node: { executable: process.execPath },
};

if (process.env.CHECKPOINT_EXECUTABLE) {
  variants.checkpoint = {
    executable: process.env.CHECKPOINT_EXECUTABLE,
    GOGC: '800',
  };
}
const { rolldown } = await import('rolldown');
const bundle = await rolldown({
  input: 'benchmarking/session.ts',
  external: ['ws', /^node:/],
  platform: 'node',
});

await bundle.write({ file: entry, format: 'esm' });
await bundle.close();
const results = [];
let maxDifference = 0;
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const metadata = {
  date: new Date().toISOString(),
  cpu,
  processor: readFileSync('/proc/cpuinfo', 'utf8').match(
    /model name\s*:\s*(.*)/,
  )?.[1],
  node: process.version,
  go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(),
  ticks,
  repetitions,
  warmupTicks: 120,
  seed: 25,
  originalCommit: 'db1b7050e0b5ecd70c808728b989816e9320c468',
  checkpointCommit: 'a750604',
  pgoHash: hash('cmd/go-server/default.pgo'),
  nodeHarnessHash: hash(entry),
  variants: Object.fromEntries(
    Object.entries(variants).map(([name, value]) => [
      name,
      { ...value, executableHash: hash(value.executable) },
    ]),
  ),
  numericTolerances: { upTo16Players: 2e-8, from32Players: 1e-6 },
  originalOutcomeComparison: 'report',
  latestNodeOutcomeComparison: 'strict',
  packetParityResult: '2026-10-01-followup-parity.json',
};
const median = (values) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

function compare(a, b, path, tolerance) {
  if (typeof a === 'number' && typeof b === 'number') {
    maxDifference = Math.max(maxDifference, Math.abs(a - b));
    assert(Math.abs(a - b) <= tolerance, `${path}: ${a} != ${b}`);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(
      Object.keys(a).sort(),
      Object.keys(b).sort(),
      `${path} keys`,
    );

    for (const key of Object.keys(a)) {
      compare(a[key], b[key], `${path}.${key}`, tolerance);
    }
  } else assert.deepEqual(a, b, path);
}
function save() {
  writeFileSync(
    result,
    JSON.stringify({ ...metadata, maxDifference, results }, null, 2) + '\n',
  );
}

try {
  for (const players of [4, 8, 16, 32]) {
    for (const workload of ['convoy', 'spread', 'contact', 'module']) {
      for (let repetition = 0; repetition < repetitions; repetition++) {
        const pair = {};
        // Rotate all positions and reverse every cycle to balance process order.
        const names = Object.keys(variants);

        if (repetition % (names.length * 2) >= names.length) names.reverse();
        const offset = repetition % names.length;
        const order = [...names.slice(offset), ...names.slice(0, offset)];

        for (const variant of order) {
          const value = variants[variant];
          const file = join(directory, `${variant}.json`);
          const command =
            variant === 'node'
              ? [value.executable, entry]
              : [value.executable, '-test.run', '^TestSessionBenchmark$'];

          execFileSync('taskset', ['-c', cpu, ...command], {
            env: {
              ...process.env,
              GOMAXPROCS: '1',
              GOGC: value.GOGC || '100',
              GO_SERVER_SIMD: '',
              GO_SERVER_COLLISION_NEIGHBORS: '',
              GO_SERVER_MOTION_ROUNDING: '',
              SESSION_PLAYERS: String(players),
              SESSION_WORKLOAD: workload,
              SESSION_TICKS: String(ticks),
              SESSION_SEED: '25',
              SESSION_TRACE: '',
              CONTACT_TRACE: '',
              SESSION_CPU_PROFILE: '',
              SESSION_RESULT: file,
            },
            stdio: ['ignore', 'pipe', 'inherit'],
          });
          pair[variant] = JSON.parse(readFileSync(file));

          for (const field of ['traces', 'contactTrace', 'eventTrace']) {
            delete pair[variant][field];
          }
          results.push({ ...pair[variant], variant, repetition });
        }

        for (const field of [
          'contacts',
          'events',
          'packets',
          'entities',
          'states',
        ]) {
          compare(
            pair.latest[field],
            pair.node[field],
            `${players}/${workload}/${field}`,
            players >= 32 ? 1e-6 : 2e-8,
          );
        }
        save();
      }
      const samples = results.filter(
        (sample) => sample.players === players && sample.workload === workload,
      );
      const medians = Object.keys(variants).map((variant) =>
        median(
          samples
            .filter((sample) => sample.variant === variant)
            .map((sample) => sample.cpuMsPerTick),
        ),
      );

      console.log(
        `${players}/${workload}: original ${medians[0].toFixed(6)}, latest ${medians[1].toFixed(6)}, Node ${medians[2].toFixed(6)} ms CPU/tick`,
      );
    }
  }
} finally {
  rmSync(entry, { force: true });
  rmSync(directory, { recursive: true, force: true });
}
console.log(result);
