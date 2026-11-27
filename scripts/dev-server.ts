import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, watch, type FSWatcher } from 'node:fs';

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

const scheduleRebuild = () => {
  clearTimeout(timer);

  timer = setTimeout(() => {
    void rebuild();
  }, 100);
};

const sourceExtension = /\.(rs|ts|toml|lock)$/;

const watchSourceTree = (directory: string) =>
  watch(directory, { recursive: true }, (_, filename) => {
    if (filename && sourceExtension.test(filename)) scheduleRebuild();
  });

const watchServerSources = () => {
  const root = 'src/server';
  const children = new Map<string, FSWatcher>();

  const refreshDirectories = () => {
    const directories = new Set(
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'target')
        .map(({ name }) => name),
    );
    let changed = false;

    for (const [name, watcher] of children) {
      if (directories.has(name)) continue;
      watcher.close();
      children.delete(name);
      changed = true;
    }

    for (const name of directories) {
      if (children.has(name)) continue;
      children.set(name, watchSourceTree(`${root}/${name}`));
      changed = true;
    }

    return changed;
  };

  // Exclude Cargo output at registration so generated folders use no watch slots.
  const watcher = watch(root, (event, filename) => {
    if (!filename || filename === 'target') return;
    const directoryChanged = event === 'rename' && refreshDirectories();

    if (directoryChanged || sourceExtension.test(filename)) {
      scheduleRebuild();
    }
  });

  refreshDirectories();

  return () => {
    watcher.close();
    children.forEach((watcher) => watcher.close());
  };
};

// A managed benchmark keeps its compiled simulation fixed until capture ends.
const stopWatching = process.env.NPC_BENCHMARK_SESSION
  ? []
  : [
      watchServerSources(),
      ...['src/specs', 'scripts', 'src/client'].map((directory) => {
        const watcher = watchSourceTree(directory);

        return () => watcher.close();
      }),
    ];

const shutdown = async () => {
  stopping = true;
  clearTimeout(timer);
  stopWatching.forEach((stop) => stop());
  command?.kill('SIGTERM');
  await stopServer();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
void rebuild();
