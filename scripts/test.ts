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
import { parseArgs } from 'node:util';
import testReporter from './test-reporter.ts';

// Start the heavier simulations and integration checks first.
const testOrder = new Map(
  [
    'tests/client/projectile-prediction.test.ts',
    'tests/parity/gate-collisions.test.ts',
    'tests/integration/server-integration.test.ts',
    'tests/integration/trade-integration.test.ts',
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

const rustFixtures = new Map([
  ['tests/client/beam-visibility.test.ts', 'beam_visibility_fixture'],
  ['tests/client/projectile-prediction.test.ts', 'projectile_prediction'],
  ['tests/client/ship-destruction.test.ts', 'ship_destruction_fixture'],
  ['tests/integration/trade-integration.test.ts', 'trade_fixture'],
  ['tests/parity/gate-collisions.test.ts', 'gate_collisions_fixture'],
]);

const {
  values: { 'skip-build': skipBuild, suite },
  positionals: requested,
} = parseArgs({
  options: {
    'skip-build': { type: 'boolean' },
    suite: { type: 'string' },
  },
  allowPositionals: true,
});

let files = testFiles;

if (suite !== undefined) {
  if (!['production', 'fixtures', 'standalone'].includes(suite)) {
    throw new Error('Choose --suite production, fixtures, or standalone');
  }

  if (requested.length) {
    throw new Error('Choose a suite or individual tests');
  }

  files = testFiles.filter((file) => testSuite(file) === suite);
} else if (requested.length) {
  files = [...new Set(requested.flatMap(selectFiles))];
}

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

function testSuite(file: string) {
  if (rustFixtures.has(file)) return 'fixtures';
  return file.startsWith('tests/integration/') ? 'production' : 'standalone';
}

function selectFiles(name: string) {
  const normalized = name === 'snapshot' ? 'binary-snapshot' : testName(name);
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

  return matches;
}

async function run(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code, signal] = await once(child, 'exit');

  if (signal) console.error(`Tests terminated by ${signal}`);

  if (code !== 0) process.exit(code ?? 1);
}

const needsServer = nodeFiles.some((file) => testSuite(file) === 'production');

const examples = new Set(
  nodeFiles.flatMap((file) => {
    const example = rustFixtures.get(file);

    return example ? [example] : [];
  }),
);

const fullBuild =
  suite === 'production' || (suite === undefined && !requested.length);

if (skipBuild) {
  const artifacts = [
    ...(fullBuild || needsServer ? ['bin/server'] : []),
    ...(fullBuild ? ['dist/index.html'] : []),
  ];

  for (const artifact of artifacts) {
    if (!existsSync(artifact)) {
      throw new Error(
        `Missing ${artifact}; run npm run build before --skip-build`,
      );
    }
  }
} else if (fullBuild) {
  await run('npm', ['run', 'build']);
} else if (nodeFiles.length) {
  await run('npm', ['run', 'typecheck']);

  if (needsServer) {
    await run('npm', ['run', 'build:server']);
  }
}

if (examples.size) {
  await run(process.execPath, [
    '--import',
    './scripts/register-typescript.ts',
    'scripts/generate-example-modules.ts',
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
    ...[...examples].flatMap((example) => ['--example', example]),
  ]);
}

if (nodeFiles.length) {
  const directory = mkdtempSync(join(tmpdir(), 'unicorn-tests-'));
  const cachePath = join(directory, 'build-cache.json');
  const needsProduction = nodeFiles.some((file) =>
    /\b(?:testBuildPlugin|buildPlugin|runProductionScenario)\b/.test(
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
