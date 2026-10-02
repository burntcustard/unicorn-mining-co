// Compare separately compiled Go session executables. Run sequentially on one CPU.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [label, executable, previous] = process.argv.slice(2);

if (!label || !executable) {
  throw new Error(
    'Usage: node benchmarking/tools/go-cpu.mjs LABEL EXECUTABLE [PREVIOUS_JSON]',
  );
}
const cpu =
  process.env.CPUSET ||
  readFileSync('/proc/self/status', 'utf8').match(
    /Cpus_allowed_list:\s*(\d+)/,
  )[1];
const ticks = Number(process.env.TICKS || 900);
const repetitions = Number(process.env.REPETITIONS || 3);
const counts = (process.env.PLAYERS || '4,8,16,32').split(',').map(Number);
const workloads = (
  process.env.WORKLOADS || 'convoy,spread,contact,module'
).split(',');
const results = [];

const baseline = previous
  ? JSON.parse(
      (previous.endsWith('.gz')
        ? gunzipSync(readFileSync(previous))
        : readFileSync(previous)
      ).toString(),
    )
  : null;
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const players of counts) {
  for (const workload of workloads) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const path = `/tmp/unicorn-cpu-${process.pid}.json`;

      execFileSync(
        'taskset',
        ['-c', cpu, executable, '-test.run', '^TestSessionBenchmark$'],
        {
          env: {
            ...process.env,
            GOMAXPROCS: process.env.GOMAXPROCS || '1',
            SESSION_PLAYERS: String(players),
            SESSION_WORKLOAD: workload,
            SESSION_TICKS: String(ticks),
            SESSION_RESULT: path,
            SESSION_TRACE: '',
            CONTACT_TRACE: '',
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      const result = JSON.parse(readFileSync(path));

      delete result.traces;
      delete result.contactTrace;
      delete result.eventTrace;
      results.push({ ...result, repetition });
      writeFileSync(
        `/tmp/unicorn-${label}-partial.json`,
        JSON.stringify(results),
      );
    }
    const samples = results.filter(
      (r) => r.players === players && r.workload === workload,
    );
    const current = median(samples.map((r) => r.cpuMsPerTick));
    const old = baseline?.results.filter(
      (r) => r.players === players && r.workload === workload,
    );

    console.log(
      `${players}/${workload}: ${current.toFixed(6)} ms CPU/tick${old?.length ? ` (${((current / median(old.map((r) => r.cpuMsPerTick)) - 1) * 100).toFixed(1)}%)` : ''}`,
    );
  }
}
const path = process.env.RESULT || `benchmarking/local/${label}.json`;

mkdirSync(dirname(path), { recursive: true });

writeFileSync(
  path,
  JSON.stringify(
    {
      label,
      executableHash: createHash('sha256')
        .update(readFileSync(executable))
        .digest('hex'),
      revision: process.env.SOURCE_REVISION || 'working-tree',
      cpu,
      ticks,
      repetitions,
      go: process.env.GO_VERSION || 'go1.27.1',
      environment: {
        GOGC: process.env.GOGC || '100',
        GOMAXPROCS: process.env.GOMAXPROCS || '1',
        GOEXPERIMENT: process.env.GOEXPERIMENT || '',
      },
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(path);
