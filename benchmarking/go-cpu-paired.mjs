// Measure before/after executables sequentially, alternating process order.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [label, before, after] = process.argv.slice(2);

if (!label || !before || !after) {
  throw new Error(
    'Usage: node benchmarking/go-cpu-paired.mjs LABEL BEFORE AFTER',
  );
}
const cpu =
  process.env.CPU_AFFINITY ||
  readFileSync('/proc/self/status', 'utf8').match(
    /Cpus_allowed_list:\s*(\d+)/,
  )[1];
const gomaxprocs = process.env.GOMAXPROCS || '1';
const ticks = Number(process.env.TICKS || 900);
const repetitions = Number(process.env.REPETITIONS || 5);
const motionTolerance = Number(process.env.MOTION_TOLERANCE || 2e-8);
const motionDifferences = {};
const outcomeComparison = process.env.OUTCOME_COMPARISON || 'strict';

assert(['strict', 'report'].includes(outcomeComparison));
const players = (process.env.PLAYERS || '4,8,16,32').split(',').map(Number);
const workloads = (
  process.env.WORKLOADS || 'convoy,spread,contact,module'
).split(',');
const variants = {
  before: {
    executable: before,
    GOGC: process.env.BEFORE_GOGC || '100',
    GOMAXPROCS: process.env.BEFORE_GOMAXPROCS || gomaxprocs,
    SIMD: process.env.BEFORE_SIMD,
    motionRounding: process.env.BEFORE_ROUNDING,
    collisionNeighbors: process.env.BEFORE_NEIGHBORS,
  },
  after: {
    executable: after,
    GOGC: process.env.AFTER_GOGC || '800',
    GOMAXPROCS: process.env.AFTER_GOMAXPROCS || gomaxprocs,
    SIMD: process.env.AFTER_SIMD,
    motionRounding: process.env.AFTER_ROUNDING,
    collisionNeighbors: process.env.AFTER_NEIGHBORS,
  },
};
const results = [];
const median = (values) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const path = `benchmarking/results/2026-10-01-${label}.json`;

function compare(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    const motion = path.match(
      /states\.\d+\.(position\.[xy]|velocity\.[xy]|rotation|spin)$/,
    )?.[1];
    const difference = Math.abs(a - b);

    if (motion) {
      motionDifferences[motion] = Math.max(
        motionDifferences[motion] || 0,
        difference,
      );
    }
    assert(
      difference <= (motion ? motionTolerance : 2e-8),
      `${path}: ${a} != ${b}`,
    );
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(
      Object.keys(a).sort(),
      Object.keys(b).sort(),
      `${path} keys`,
    );

    for (const key of Object.keys(a)) compare(a[key], b[key], `${path}.${key}`);
  } else assert.deepEqual(a, b, path);
}
function save() {
  writeFileSync(
    path,
    JSON.stringify(
      {
        label,
        cpu,
        gomaxprocs,
        ticks,
        repetitions,
        motionTolerance,
        motionDifferences,
        outcomeComparison,
        variants: Object.fromEntries(
          Object.entries(variants).map(([name, value]) => [
            name,
            {
              ...value,
              executableHash: createHash('sha256')
                .update(readFileSync(value.executable))
                .digest('hex'),
            },
          ]),
        ),
        results,
      },
      null,
      2,
    ) + '\n',
  );
}

for (const count of players) {
  for (const workload of workloads) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const pair = {};

      for (const variant of repetition % 2
        ? ['after', 'before']
        : ['before', 'after']) {
        const value = variants[variant];
        const output = `/tmp/unicorn-cpu-paired-${process.pid}.json`;

        execFileSync(
          'taskset',
          ['-c', cpu, value.executable, '-test.run', '^TestSessionBenchmark$'],
          {
            env: {
              ...process.env,
              GOMAXPROCS: value.GOMAXPROCS,
              GOGC: value.GOGC,
              GO_SERVER_SIMD: value.SIMD ?? process.env.GO_SERVER_SIMD ?? '',
              GO_SERVER_MOTION_ROUNDING: value.motionRounding ?? '',
              GO_SERVER_COLLISION_NEIGHBORS: value.collisionNeighbors ?? '',
              SESSION_PLAYERS: String(count),
              SESSION_WORKLOAD: workload,
              SESSION_TICKS: String(ticks),
              SESSION_TRACE: '',
              CONTACT_TRACE: '',
              SESSION_RESULT: output,
            },
            stdio: ['ignore', 'pipe', 'inherit'],
          },
        );
        pair[variant] = JSON.parse(readFileSync(output));
        delete pair[variant].traces;
        delete pair[variant].contactTrace;
        delete pair[variant].eventTrace;
        results.push({ ...pair[variant], variant, repetition });
        save();
      }

      for (const field of outcomeComparison === 'strict'
        ? ['contacts', 'events', 'packets', 'bytes', 'entities', 'states']
        : []) {
        compare(
          pair.before[field],
          pair.after[field],
          `${count}/${workload}/${field}`,
        );
      }
    }
    const samples = results.filter(
      (r) => r.players === count && r.workload === workload,
    );
    const old = median(
      samples.filter((r) => r.variant === 'before').map((r) => r.cpuMsPerTick),
    );
    const current = median(
      samples.filter((r) => r.variant === 'after').map((r) => r.cpuMsPerTick),
    );

    console.log(
      `${count}/${workload}: ${old.toFixed(6)} -> ${current.toFixed(6)} ms CPU/tick (${(old / current).toFixed(2)}x)`,
    );
    save();
  }
}
console.log(path);
