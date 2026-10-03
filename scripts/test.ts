import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const testFiles = ['tests', 'src/server']
  .flatMap((directory) =>
    readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .filter((file) => /(?:\.test\.(?:mjs|js|ts)|_test\.go)$/.test(file))
      .map((file) => join(directory, file)),
  )
  .sort();
const requested = process.argv.slice(2);
const files = requested.length
  ? [...new Set(requested.flatMap(selectFiles))]
  : testFiles;
const nodeFiles = files.filter((file) => !file.endsWith('.go'));
const goFiles = files.filter((file) => file.endsWith('.go'));
const concurrency = Number(
  process.env.TEST_CONCURRENCY || Math.min(4, availableParallelism()),
);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('TEST_CONCURRENCY must be a positive integer');
}

function testName(name: string) {
  return name
    .replace(/^\.\//, '')
    .replace(/(?:\.test\.(?:mjs|js|ts)|_test\.go)$/, '');
}

function selectFiles(name: string) {
  const normalized = testName(name);
  const exact = testFiles.filter(
    (file) =>
      basename(file) === name ||
      [
        resolve(name),
        resolve('tests', name),
        resolve('src/server', name),
      ].includes(resolve(file)),
  );
  const matches = exact.length
    ? exact
    : testFiles.filter(
        (file) =>
          [
            file,
            relative('tests', file),
            relative('src/server', file),
            basename(file),
          ]
            .map(testName)
            .includes(normalized) || resolve(file) === resolve(name),
      );

  if (!matches.length) {
    const directoryFiles = testFiles.filter((file) =>
      resolve(file).startsWith(resolve(name) + sep),
    );

    if (directoryFiles.length) return directoryFiles;
  }

  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `Ambiguous test file: ${name}. Use a path: ${matches.join(', ')}`
        : `Unknown test file: ${name}`,
    );
  }

  return matches;
}

const goPackages = new Map<string, string[]>();

if (requested.length) {
  for (const file of goFiles) {
    const names = [
      ...readFileSync(file, 'utf8').matchAll(
        /^func\s+((?:Test|Example|Fuzz)\w*)\s*\(/gm,
      ),
    ].map((match) => match[1]);
    const directory = dirname(file);

    goPackages.set(directory, [...(goPackages.get(directory) ?? []), ...names]);
  }

  for (const [directory, names] of goPackages) {
    if (!names.length) {
      throw new Error(`No runnable Go tests selected in ${directory}`);
    }
  }
}

async function run(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code, signal] = await once(child, 'exit');

  if (signal) console.error(`Tests terminated by ${signal}`);

  if (code !== 0) process.exit(code ?? 1);
}

const needsServer = nodeFiles.some((file) =>
  file.startsWith('tests/integration/'),
);
const needsFixtures =
  goFiles.length > 0 ||
  nodeFiles.some((file) => file.startsWith('tests/parity/'));

if (requested.length && nodeFiles.length) {
  await run('npm', ['run', 'typecheck']);
}

if (!requested.length) {
  await run('npm', ['run', 'build']);
} else if (needsServer) {
  await run('npm', ['run', 'build:server']);
} else if (needsFixtures) {
  await run('npm', ['run', 'catalog:go']);
}

if (needsFixtures) {
  await run(process.execPath, [
    '--import',
    'tsx',
    'tests/parity/generate-fixtures.ts',
  ]);
}

if (nodeFiles.length) {
  await run(process.execPath, [
    '--import',
    'tsx',
    '--test',
    '--test-reporter=spec',
    `--test-concurrency=${concurrency}`,
    ...nodeFiles,
  ]);
}

const goEnv = { ...process.env, GOEXPERIMENT: 'simd' };

if (!requested.length) {
  await run('go', ['test', './src/server/...'], goEnv);
} else {
  for (const [directory, names] of goPackages) {
    await run(
      'go',
      ['test', '-run', `^(${names.join('|')})$`, `./${directory}`],
      goEnv,
    );
  }
}
