import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function run(executable: string, args: string[]) {
  const child = spawn(executable, args, { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(`${executable} exited with ${signal ?? code}`);
  }
}

const cargo = [
  '--locked',
  '--manifest-path',
  'src/server/Cargo.toml',
  '--target-dir',
  'src/server/target',
];

await run('npm', ['run', 'build']);
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
await run('cargo', ['test', ...cargo]);
await run('cargo', ['test', ...cargo, '--', '--ignored']);

await run(process.execPath, [
  'scripts/test.ts',
  '--skip-build',
  ...(process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        'tests/parity',
        'tests/integration',
        'beam-visibility',
        'muzzle-flash',
        'projectile-prediction',
        'ship-destruction',
      ]),
]);
