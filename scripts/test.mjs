import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const testFiles = readdirSync('tests', { recursive: true })
  .filter((file) => /\.test\.(?:mjs|js|ts)$/.test(file))
  .map((file) => join('tests', file))
  .sort();
const requested = process.argv.slice(2);
const files = requested.length
  ? [...new Set(requested.map(selectFile))]
  : testFiles;
const concurrency = Number(
  process.env.TEST_CONCURRENCY || Math.min(4, availableParallelism()),
);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('TEST_CONCURRENCY must be a positive integer');
}

function selectFile(name) {
  const normalized = name
    .replace(/^\.\//, '')
    .replace(/\.test\.(?:mjs|js|ts)$/, '');
  const matches = testFiles.filter(
    (file) =>
      [file, relative('tests', file), basename(file)]
        .map((path) => path.replace(/\.test\.(?:mjs|js|ts)$/, ''))
        .includes(normalized) || resolve(file) === resolve(name),
  );

  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `Ambiguous test file: ${name}. Use a path: ${matches.join(', ')}`
        : `Unknown test file: ${name}`,
    );
  }

  return matches[0];
}

async function run(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code, signal] = await once(child, 'exit');

  if (signal) console.error(`Tests terminated by ${signal}`);

  if (code !== 0) process.exit(code ?? 1);
}

if (!requested.length) {
  await run('npm', ['run', 'build']);
} else if (files.some((file) => file.startsWith('tests/integration/'))) {
  await run('npm', ['run', 'build:server']);
}

if (files.some((file) => file.startsWith('tests/parity/'))) {
  if (requested.length) await run('npm', ['run', 'catalog:go']);
  await run(process.execPath, [
    '--import',
    'tsx',
    'tests/parity/generate-fixtures.ts',
  ]);
}

await run(process.execPath, [
  '--import',
  'tsx',
  '--test',
  '--test-reporter=spec',
  `--test-concurrency=${concurrency}`,
  ...files,
]);

if (!requested.length) {
  await run('go', ['test', './src/server/...'], {
    ...process.env,
    GOEXPERIMENT: 'simd',
  });
}
