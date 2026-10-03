import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

let server;
let command;
let timer;
let rebuilding = false;
let pending = false;
let stopping = false;

const run = (executable, args) =>
  new Promise((resolve, reject) => {
    command = spawn(executable, args, {
      stdio: 'inherit',
      env: { ...process.env, GOEXPERIMENT: 'simd' },
    });
    command.on('error', reject);
    command.on('exit', (code) => {
      command = undefined;

      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code}`));
    });
  });

const stopServer = () =>
  new Promise((resolve) => {
    if (!server || server.exitCode !== null || server.signalCode) {
      return resolve();
    }
    server.once('exit', resolve);
    server.kill('SIGTERM');
  });

const rebuild = async () => {
  if (stopping) return;

  if (rebuilding) {
    pending = true;
    return;
  }
  rebuilding = true;

  try {
    await stopServer();
    await run(process.execPath, [
      '--import',
      'tsx',
      'scripts/generate-go-catalog.ts',
    ]);
    await run('go', ['build', '-o', 'bin/server', './src/server']);

    if (!stopping) {
      server = spawn('./bin/server', [], { stdio: 'inherit' });
      server.on('error', (error) => console.error(error.message));
    }
  } catch (error) {
    if (!stopping) console.error(error.message);
  } finally {
    rebuilding = false;

    if (pending && !stopping) {
      pending = false;
      void rebuild();
    }
  }
};

const watchers = ['src/server', 'src/definitions'].map((directory) =>
  watch(directory, { recursive: true }, (_, filename) => {
    if (
      !filename ||
      filename.endsWith('catalog_gen.go') ||
      filename.endsWith('_test.go')
    ) {
      return;
    }

    if (!/\.(go|ts)$/.test(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, 100);
  }),
);

const shutdown = async () => {
  stopping = true;
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  command?.kill('SIGTERM');
  await stopServer();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
void rebuild();
