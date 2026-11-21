import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { run as runTests } from 'node:test';
import testReporter from './test-reporter.ts';

// Start the heavier simulations and integration checks first.
const testOrder = new Map(
  [
    'tests/client/projectile-prediction-repeated.test.ts',
    'tests/client/projectile-prediction.test.ts',
    'tests/client/muzzle-flash.test.ts',
    'tests/client/projectile-prediction-plasma.test.ts',
    'tests/parity/gate-collisions.test.ts',
    'tests/integration/trade-integration.test.ts',
    'tests/client/projectile-prediction-triangles.test.ts',
    'tests/client/weapons.test.ts',
    'tests/linting/oxlint-formatting.test.ts',
    'tests/client/ship-destruction.test.ts',
    'tests/client/gate-modules.test.ts',
    'tests/client/beam-visibility.test.ts',
  ].map((file, index) => [file, index]),
);

const testFiles = readdirSync('tests', { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => join('tests', file))
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
const nodeFiles = files.sort(
  (a, b) =>
    (testOrder.get(a) ?? testOrder.size) -
      (testOrder.get(b) ?? testOrder.size) || a.localeCompare(b, 'en-US'),
);
const concurrency = Number(
  process.env.TEST_CONCURRENCY || Math.min(4, availableParallelism()),
);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('TEST_CONCURRENCY must be a positive integer');
}

function testName(name: string) {
  return name.replace(/^\.\//, '').replace(/\.test\.ts$/, '');
}

function selectFiles(name: string) {
  const normalized = testName(name);
  const exact = testFiles.filter(
    (file) =>
      basename(file) === name ||
      [resolve(name), resolve('tests', name)].includes(resolve(file)),
  );
  const matches = exact.length
    ? exact
    : testFiles.filter(
        (file) =>
          [file, relative('tests', file), basename(file)]
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

async function run(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code, signal] = await once(child, 'exit');

  if (signal) console.error(`Tests terminated by ${signal}`);

  if (code !== 0) process.exit(code ?? 1);
}

const needsServer = nodeFiles.some((file) =>
  file.startsWith('tests/integration/'),
);
const needsFixtures = nodeFiles.some((file) =>
  /tests\/parity\/|(?:beam-visibility|muzzle-flash|projectile-prediction(?:-[a-z]+)?|ship-destruction|trade-integration)\.test\.ts$/.test(
    file,
  ),
);

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
  }
}

if (needsFixtures) {
  await run(process.execPath, [
    '--import',
    './scripts/register-typescript.ts',
    'scripts/generate-example-modules.ts',
  ]);
  await run(process.execPath, [
    '--import',
    './scripts/register-typescript.ts',
    '--import',
    './tests/support/local-storage.ts',
    'tests/parity/generate-fixtures.ts',
  ]);
  await run('cargo', [
    'build',
    '--locked',
    '--manifest-path',
    'src/server/Cargo.toml',
    '--target-dir',
    'src/server/target',
    '--no-default-features',
    '--features',
    'test-fixtures',
    '--examples',
  ]);
}

if (nodeFiles.length) {
  const directory = mkdtempSync(join(tmpdir(), 'unicorn-tests-'));
  const cachePath = join(directory, 'build-cache.json');
  const needsProduction = nodeFiles.some((file) =>
    /\b(?:testBuildPlugin|buildPlugin|runProjectilePrediction)\b/.test(
      readFileSync(file, 'utf8'),
    ),
  );

  try {
    if (needsProduction) {
      const { preparePropertyCache } =
        await import('../plugins/build-plugins.ts');

      writeFileSync(cachePath, JSON.stringify(await preparePropertyCache()));
    }

    // The CLI sorts filenames again; the programmatic runner preserves this
    // priority order while keeping each file in its own process.
    const tests = runTests({
      files: nodeFiles,
      concurrency,
      execArgv: [
        '--import',
        './scripts/register-typescript.ts',
        '--import',
        './tests/support/local-storage.ts',
      ],
      env: {
        ...process.env,
        ...(needsProduction ? { TEST_BUILD_CACHE: cachePath } : {}),
      },
    });

    tests.on('test:fail', () => {
      process.exitCode = 1;
    });

    for await (const chunk of testReporter(tests)) {
      if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
