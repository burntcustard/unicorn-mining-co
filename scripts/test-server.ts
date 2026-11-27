import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function run(executable: string, args: string[]) {
  const child = spawn(executable, args, { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(`${executable} exited with ${signal ?? code}`);
  }
}

const requested = process.argv.slice(2);
const rustOnly = requested[0] === '--rust-only';

if (!rustOnly) await run('npm', ['run', 'build']);

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
  'test',
  '--locked',
  '--manifest-path',
  'src/server/Cargo.toml',
  '--target-dir',
  'src/server/target',
  ...(rustOnly
    ? ['--no-default-features', '--features', 'test-fixtures', '--lib']
    : []),
  '--',
  '--include-ignored',
]);

if (!rustOnly) {
  await run(process.execPath, [
    'scripts/test.ts',
    '--skip-build',
    ...(requested.length
      ? requested
      : [
          'tests/parity',
          'tests/integration',
          'beam-visibility',
          'projectile-prediction',
          'ship-destruction',
        ]),
  ]);
}
