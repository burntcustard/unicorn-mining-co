import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const temporaryDirectory = resolve('.tmp');

mkdirSync(temporaryDirectory, { recursive: true });

const env = {
  ...process.env,
  TMPDIR: temporaryDirectory,
  TMP: temporaryDirectory,
  TEMP: temporaryDirectory,
};

const manifest = ['--manifest-path', 'src/server/Cargo.toml'];

for (const args of [
  ['fmt', ...manifest, '--check'],
  [
    'clippy',
    '--locked',
    ...manifest,
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings',
    ...process.argv.slice(2),
  ],
]) {
  const { error, status } = spawnSync('cargo', args, { env, stdio: 'inherit' });

  if (error) throw error;

  if (status !== 0) process.exit(status ?? 1);
}
