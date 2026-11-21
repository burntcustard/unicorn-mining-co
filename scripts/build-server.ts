import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const target = process.env.SERVER_BUILD_TARGET;
const fixtures = process.argv.includes('--benchmark-fixtures');
const targetDir = fixtures
  ? 'src/server/target/benchmark'
  : 'src/server/target';
const cargo = spawn(
  'cargo',
  [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    'src/server/Cargo.toml',
    '--target-dir',
    targetDir,
    ...(fixtures ? ['--features', 'benchmark-fixtures'] : []),
    '--bin',
    'unicorn-mining-server',
    ...(target ? ['--target', target] : []),
  ],
  { stdio: 'inherit' },
);

const interrupt = () => cargo.kill('SIGINT');
const terminate = () => cargo.kill('SIGTERM');

process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
const [code] = await once(cargo, 'exit');

process.removeListener('SIGINT', interrupt);
process.removeListener('SIGTERM', terminate);

if (code !== 0) process.exit(code ?? 1);

// Replace the file atomically so an existing process can keep running its build.
const directory = fixtures ? 'bin/benchmark' : 'bin';

mkdirSync(directory, { recursive: true });
const executable = join(directory, 'server');
const pending = `${executable}.${process.pid}`;

copyFileSync(
  join(targetDir, target ?? '', 'release', 'unicorn-mining-server'),
  pending,
);
chmodSync(pending, 0o755);
renameSync(pending, executable);
