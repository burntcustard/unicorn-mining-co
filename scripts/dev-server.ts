import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';

const fixtures = process.env.SERVER_BENCHMARK_FIXTURES === '1';
const executable = fixtures ? './bin/benchmark/server' : './bin/server';

let server: ChildProcess;
let command: ChildProcess;
let timer: ReturnType<typeof setTimeout>;
let rebuilding = false;
let pending = false;
let stopping = false;

const run = (executable: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    command = spawn(executable, args, {
      stdio: 'inherit',
    });

    command.on('error', reject);

    command.on('exit', (code) => {
      command = undefined;

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${executable} exited with ${code}`));
      }
    });
  });

const stopServer = () =>
  new Promise<void>((resolve) => {
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
    await run(process.execPath, [
      'scripts/build-server.ts',
      ...(fixtures ? ['--benchmark-fixtures'] : []),
    ]);

    if (stopping) return;
    await stopServer();

    if (!stopping) {
      server = spawn(executable, [], {
        stdio: 'inherit',
        env: { ...process.env, APP_ENV: 'development' },
      });

      server.on('error', (error) => console.error(error.message));
    }
  } catch (error) {
    if (!stopping) {
      console.error(error instanceof Error ? error.message : error);
    }
  } finally {
    rebuilding = false;

    if (pending && !stopping) {
      pending = false;
      void rebuild();
    }
  }
};

// A managed benchmark keeps its compiled simulation fixed until capture ends.
const watchers = (
  process.env.NPC_BENCHMARK_SESSION
    ? []
    : ['src/server', 'src/specs', 'scripts', 'src/client']
).map((directory) =>
  watch(directory, { recursive: true }, (_, filename) => {
    if (!filename || filename.startsWith('target/')) return;

    if (!/\.(rs|ts|toml|lock)$/.test(filename)) return;
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
