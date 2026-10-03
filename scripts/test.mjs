import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const suites = {
  formatting: ['formatting.test.mjs'],
  shared: ['shared-objects.test.mjs', 'rendering.test.mjs'],
  simulation: ['simulation.test.mjs', 'snapshots.test.mjs'],
  regions: ['regions.test.mjs'],
  server: [
    'server.test.ts',
    'server-lag.test.ts',
    'networking.test.ts',
    'binary-replication.test.ts',
    'binary-control.test.ts',
    'binary-snapshot.test.ts',
    'snapshot-cadence.test.ts',
  ],
  reconnect: ['reconnect.test.ts'],
  packets: ['packet-size.test.ts'],
  prediction: [
    'remote-motion.test.ts',
    'remote-trajectory.test.ts',
    'remote-handoff.test.ts',
    'remote-contact.test.ts',
    'remote-perspectives.test.ts',
    'remote-input-response.test.ts',
    'network-stalls.test.ts',
    'prediction.test.ts',
  ],
  collisions: ['collisions.test.mjs'],
  docked: [
    'docked.test.mjs',
    'lazy-docked.test.mjs',
    'property-mangling.test.mjs',
  ],
  input: ['input.test.mjs', 'module-input.test.mjs'],
  prism: ['prism.test.mjs'],
  sound: ['sound.test.mjs'],
};

const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(suites);
const concurrency = Number(
  process.env.TEST_CONCURRENCY || Math.min(4, availableParallelism()),
);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('TEST_CONCURRENCY must be a positive integer');
}

for (const suite of selected) {
  if (!Object.hasOwn(suites, suite)) {
    throw new Error(`Unknown test suite: ${suite}`);
  }
}

const files = [...new Set(selected.flatMap((suite) => suites[suite]))];
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    '--test-reporter=spec',
    `--test-concurrency=${concurrency}`,
    ...files.map((file) => `tests/${file}`),
  ],
  { stdio: 'inherit' },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) console.error(`Tests terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
