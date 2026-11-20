import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';

const rust = process.argv.includes('--rust');
const executable = rust
  ? './src/server-rust/target/release/unicorn-mining-server'
  : './bin/server';

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
      env: { ...process.env, GOEXPERIMENT: 'simd' },
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
    await stopServer();

    if (rust) {
      await run('cargo', [
        'build',
        '--locked',
        '--release',
        '--manifest-path',
        'src/server-rust/Cargo.toml',
        '--target-dir',
        'src/server-rust/target',
      ]);
    } else {
      await run(process.execPath, [
        '--import',
        'tsx',
        'scripts/generate-go-catalog.ts',
      ]);
      await run('go', ['build', '-o', 'bin/server', './src/server-go']);
    }

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
    : [rust ? 'src/server-rust/src' : 'src/server-go', 'src/specs']
).map((directory) =>
  watch(directory, { recursive: true }, (_, filename) => {
    if (
      !filename ||
      filename.endsWith('catalog_gen.go') ||
      filename.endsWith('_test.go')
    ) {
      return;
    }

    if (!(rust ? /\.(rs|ts)$/ : /\.(go|ts)$/).test(filename)) return;
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
