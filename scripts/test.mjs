import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const suites = {
  formatting: ['client/formatting.test.mjs'],
  objects: [
    'client/objects.test.mjs',
    'client/rendering.test.mjs',
    'client/definitions.test.ts',
  ],
  simulation: ['client/simulation.test.mjs'],
  regions: ['client/regions.test.mjs'],
  protocol: ['client/binary-control.test.ts', 'client/binary-snapshot.test.ts'],
  prediction: ['client/remote-motion.test.ts', 'client/prediction.test.ts'],
  collisions: ['client/collisions.test.mjs'],
  docked: [
    'client/docked.test.mjs',
    'client/lazy-docked.test.mjs',
    'client/property-mangling.test.mjs',
  ],
  input: ['client/input.test.mjs', 'client/module-input.test.mjs'],
  prism: ['client/prism.test.mjs'],
  sound: ['client/sound.test.mjs'],
  integration: ['integration/server-integration.test.ts'],
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
