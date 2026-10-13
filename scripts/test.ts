import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const testFiles = ['tests', 'src/server']
  .flatMap((directory) =>
    readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .filter((file) => /(?:\.test\.(?:mjs|js|ts)|_test\.go)$/.test(file))
      .map((file) => join(directory, file)),
  )
  .sort();

const testGroups = new Map([
  [
    'tests/client/projectile-prediction.test.ts',
    [
      'tests/client/projectile-prediction.test.ts',
      'tests/client/projectile-prediction-plasma.test.ts',
      'tests/client/projectile-prediction-repeated.test.ts',
      'tests/client/projectile-prediction-triangles.test.ts',
    ],
  ],
]);

const skipBuild = process.argv.includes('--skip-build');
const requested = process.argv.slice(2).filter((arg) => arg !== '--skip-build');
const files = requested.length
  ? [...new Set(requested.flatMap(selectFiles))]
  : testFiles;
const nodeFiles = files.filter((file) => !file.endsWith('.go'));
const goFiles = files.filter((file) => file.endsWith('.go'));
const concurrency = Number(
  process.env.TEST_CONCURRENCY || Math.min(4, availableParallelism()),
);

const goEnv = {
  ...process.env,
  CGO_ENABLED: '0',
  GOEXPERIMENT: 'simd',
  GOFLAGS: [process.env.GOFLAGS, '-trimpath'].filter(Boolean).join(' '),
};

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

  return testGroups.get(matches[0]) ?? matches;
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

async function run(command: string, args: string[], env = goEnv) {
  console.log(`> ${command} ${args.join(' ')}`);
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

if (skipBuild) {
  const artifacts = [
    ...(!requested.length || needsServer ? ['bin/server'] : []),
    ...(!requested.length ? ['dist/index.html'] : []),
  ];

  for (const artifact of artifacts) {
    if (!existsSync(artifact)) {
      throw new Error(
        `Missing ${artifact}; run npm run build before --skip-build`,
      );
    }
  }
} else {
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
}

if (needsFixtures) {
  await run(process.execPath, [
    '--import',
    'tsx',
    '--import',
    './tests/support/local-storage.ts',
    'tests/parity/generate-fixtures.ts',
  ]);
}

if (nodeFiles.length) {
  await run(process.execPath, [
    '--import',
    'tsx',
    '--import',
    './tests/support/local-storage.ts',
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    ...(process.env.CI
      ? [
          '--test-reporter=./scripts/test-progress.ts',
          '--test-reporter-destination=stdout',
        ]
      : []),
    `--test-concurrency=${concurrency}`,
    ...nodeFiles,
  ]);
}

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
