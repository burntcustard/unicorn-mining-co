import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { prepareNPCFixture } from './fixture.ts';
import { parseNPCOptions } from './options.ts';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../..', import.meta.url));

export const collectionArguments = (args: string[]) => [
  '--scenario',
  'collection-courser,collection-finch',
  '--warmup',
  '0',
  '--seconds',
  '120',
  '--repetitions',
  '9',
  '--concurrency',
  '6',
  '--output',
  'benchmarking/_local/npc-collection.json',
  ...args,
];

type LocalProcess = {
  pid: number;
  parent: number;
  started: string;
  state: string;
  cwd: string;
  executable: string;
  args: string[];
};

/*
 * Only a verified service from this checkout may be reused or temporarily
 * replaced. An unrelated listener on either normal port is a hard conflict.
 */
export function isNPCService(
  process: LocalProcess,
  root: string,
  service: 'watcher' | 'frontend',
) {
  if (process.cwd !== root || !/\/node(?:js)?$/.test(process.executable)) {
    return false;
  }

  const scripts =
    service === 'watcher'
      ? ['scripts/dev-server.ts']
      : ['node_modules/vite/bin/vite.js', 'node_modules/.bin/vite'];

  return (
    scripts.some(
      (script) =>
        resolve(root, process.args[1] || '') === resolve(root, script),
    ) &&
    (service !== 'frontend' || !process.args.includes('preview'))
  );
}

async function localProcess(pid: number): Promise<LocalProcess> {
  const [stat, cwd, executable, command] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readlink(`/proc/${pid}/cwd`),
    readlink(`/proc/${pid}/exe`),
    readFile(`/proc/${pid}/cmdline`, 'utf8'),
  ]);
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);

  return {
    pid,
    state: fields[0],
    parent: Number(fields[1]),
    started: fields[19],
    cwd,
    executable,
    args: command.split('\0').filter(Boolean),
  };
}

async function listeners(port: number) {
  const { stdout } = await execute('ss', ['-ltnp', `sport = :${port}`]);
  const pids = [
    ...new Set(
      [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])),
    ),
  ];

  assert(pids.length <= 1, `Multiple processes are listening on port ${port}`);
  assert(
    pids.length || stdout.trim().split('\n').length <= 1,
    `Cannot identify the process using port ${port}`,
  );
  return pids;
}

async function belongsTo(pid: number, ancestor: number) {
  for (let count = 0; pid > 1 && count < 32; count++) {
    if (pid === ancestor) return true;
    const process = await localProcess(pid).catch((): null => null);

    if (!process) return false;
    pid = process.parent;
  }

  return false;
}

async function inspectServices(root: string) {
  const [front, back, entries] = await Promise.all([
    listeners(3000),
    listeners(3001),
    readdir('/proc'),
  ]);

  if (front.length) {
    assert(
      isNPCService(await localProcess(front[0]), root, 'frontend'),
      'Port 3000 is occupied by a different service; leave it running and free the normal game port before benchmarking.',
    );
  }

  const watchers = (
    await Promise.all(
      entries
        .filter((entry) => /^\d+$/.test(entry))
        .map((entry) => localProcess(Number(entry)).catch((): null => null)),
    )
  ).filter((process) => process && isNPCService(process, root, 'watcher'));

  assert(
    watchers.length <= 1,
    'Multiple Go watchers belong to this checkout. Stop the duplicate watchers before starting a collection session.',
  );
  const watcher = watchers[0];

  if (back.length) {
    assert(
      watcher && (await belongsTo(back[0], watcher.pid)),
      'Port 3001 is occupied by a server outside this checkout’s dev watcher; it will not be stopped.',
    );
  }

  let environment: NodeJS.ProcessEnv;

  if (watcher) {
    environment = Object.fromEntries(
      (await readFile(`/proc/${watcher.pid}/environ`, 'utf8'))
        .split('\0')
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf('=');

          return [entry.slice(0, separator), entry.slice(separator + 1)];
        }),
    );

    assert(
      !environment.NPC_BENCHMARK_SESSION,
      'Another managed NPC session owns the Go watcher. Wait for it to finish.',
    );
  }

  return { frontend: front[0], watcher, environment };
}

async function until(
  ready: () => Promise<boolean>,
  message: string,
  signal?: AbortSignal,
  timeout = 60000,
) {
  const deadline = Date.now() + timeout;

  while (!(await ready())) {
    signal?.throwIfAborted();
    assert(Date.now() < deadline, message);
    await pause(100, undefined, { signal });
  }
}

async function stopWatcher(watcher: LocalProcess) {
  const current = await localProcess(watcher.pid);

  assert.equal(
    current.started,
    watcher.started,
    'The Go watcher changed during preparation; refusing to stop its replacement.',
  );
  process.kill(watcher.pid, 'SIGTERM');

  await until(
    async () => {
      const current = await localProcess(watcher.pid).catch((): null => null);

      return (
        !current || current.state === 'Z' || current.started !== watcher.started
      );
    },
    'The existing Go watcher did not stop gracefully.',
    undefined,
    15000,
  );

  await until(
    async () => !(await listeners(3001)).length,
    'The previous Go server still owns port 3001.',
    undefined,
    15000,
  );
}

/*
 * Detached groups keep terminal interrupts in this launcher until cleanup can
 * close the capture, its browser, and every child of the temporary watchers.
 */
export async function startNPCProcess({
  command,
  args,
  cwd,
  env,
  log,
  visible = false,
}: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
  visible?: boolean;
}) {
  const file = await open(log, 'a');

  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: visible ? ['ignore', 'pipe', 'pipe'] : ['ignore', file.fd, file.fd],
  });

  let failure: Error;

  if (visible) {
    const capture = (stream: NodeJS.WriteStream, data: Buffer) => {
      try {
        writeSync(file.fd, data);
        stream.write(data);
      } catch (error) {
        failure = error as Error;
        child.kill('SIGTERM');
      }
    };

    child.stdout.on('data', (data: Buffer) => capture(process.stdout, data));
    child.stderr.on('data', (data: Buffer) => capture(process.stderr, data));
  }

  const completion = new Promise<{
    code: number;
    error?: Error;
    signal?: NodeJS.Signals;
  }>((resolve) => {
    child.once('error', (error) => {
      failure = error;
    });

    child.once('close', async (code, signal) => {
      if (visible) await file.close();
      resolve({ code: code ?? 1, signal, error: failure });
    });
  });

  if (!visible) await file.close();
  return { child, completion, log };
}

type OwnedProcess = Awaited<ReturnType<typeof startNPCProcess>>;

export async function stopNPCProcess(owned: OwnedProcess, grace = 15000) {
  if (!owned?.child.pid) return;
  const pid = owned.child.pid;

  const alive = async () => {
    const { stdout } = await execute('ps', ['-eo', 'pgid=,stat=']);

    return stdout
      .trim()
      .split('\n')
      .some((line) => {
        const [group, state] = line.trim().split(/\s+/);

        return Number(group) === pid && !state.startsWith('Z');
      });
  };

  if (!(await alive())) return;

  const signal = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };

  signal('SIGTERM');

  try {
    await until(
      async () => !(await alive()),
      `Process group ${pid} did not stop.`,
      undefined,
      grace,
    );
  } catch {
    signal('SIGKILL');
    await until(
      async () => !(await alive()),
      `Process group ${pid} survived SIGKILL.`,
      undefined,
      3000,
    );
  }
}

async function completed(owned: OwnedProcess, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort: () => void;

  try {
    const result = await Promise.race([
      owned.completion,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);

    if (result.error) throw result.error;

    if (result.code !== 0) {
      throw new Error(
        `Command failed (${result.signal || result.code}); see ${owned.log}`,
      );
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function readyService(
  owned: OwnedProcess,
  port: number,
  signal?: AbortSignal,
) {
  await until(
    async () => {
      assert(
        owned.child.pid &&
          owned.child.exitCode === null &&
          owned.child.signalCode === null,
        `Service exited before port ${port} was ready; see ${owned.log}`,
      );
      const current = await listeners(port);

      if (!current.length) return false;
      assert(
        await belongsTo(current[0], owned.child.pid),
        `Another process took port ${port}; see ${owned.log}`,
      );

      if (port === 3000) {
        const response = await fetch('http://localhost:3000/', {
          signal: AbortSignal.timeout(1000),
        }).catch((): null => null);

        await response?.body?.cancel();
        return response?.ok || false;
      }

      return true;
    },
    `Timed out waiting for port ${port}; see ${owned.log}`,
    signal,
  );
}

async function collectionLockError(lockPath: string, root: string) {
  const owner = await readFile(lockPath, 'utf8')
    .then((text): { pid: number; directory: string } => JSON.parse(text))
    .catch((): null => null);

  if (
    !Number.isInteger(owner?.pid) ||
    owner.pid <= 0 ||
    typeof owner.directory !== 'string'
  ) {
    return new Error(
      `Collection lock ${lockPath} has incomplete owner details. Check local collection sessions before removing that lock and retrying.`,
    );
  }

  const current = await localProcess(owner.pid).catch((): null => null);
  const details = `Collection lock ${lockPath} belongs to PID ${owner.pid}, session ${owner.directory}.`;

  if (current && current.state !== 'Z') {
    return new Error(`${details} Finish that session before starting another.`);
  }

  const services = await inspectServices(root).catch((): null => null);

  return new Error(
    services
      ? `${details} That owner has exited and no managed Go watcher remains. Remove the stale lock with rm -- '${lockPath.replaceAll("'", "'\\''")}', then retry.`
      : `${details} That owner has exited, but local service ownership could not be verified. Inspect the session and its watcher before removing the lock and retrying.`,
  );
}

export async function runCollectionSession(args: string[]) {
  const forwarded = collectionArguments(args);
  const options = parseNPCOptions({ args: forwarded });

  if (options.help) {
    console.log(
      'Usage: npm run benchmark:npc:collection -- [--watch] [--browser chrome] [--scenario collection-courser,collection-finch] [--seconds 120] [--warmup 0] [--repetitions 9] [--concurrency 6] [--seed 1] [--cores 2] [--output PATH]',
    );
    console.log(
      'Builds and runs Courser + Finch collection on a fresh private world, then restores existing local services. Standard NPC benchmark options are forwarded.',
    );
    console.log(
      'Defaults to 9 runs per ship across six continuously reused windows (three of each hull), ending on docking or after 120 seconds. The seed chooses the first repeatable layout; each repetition increments it, wrapping after 4294967295. Both ships use the same layout for each repetition.',
    );
    return;
  }

  const root = await realpath(repository);
  const output = resolve(options.output);
  const sessionReport = output.replace(/\.json$/, '') + '.session.json';

  await mkdir(resolve(root, 'benchmarking/_local'), { recursive: true });
  const lockPath = resolve(root, 'benchmarking/_local/npc-collection.lock');

  const lock = await open(lockPath, 'wx').catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
      throw await collectionLockError(lockPath, root);
    },
  );

  let directory: string;

  try {
    directory = await mkdtemp(
      resolve(root, 'benchmarking/_local/npc-collection-'),
    );
    await lock.writeFile(JSON.stringify({ pid: process.pid, directory }));
    await lock.close();
  } catch (error) {
    await lock.close();
    await unlink(lockPath);
    throw error;
  }

  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new Error('NPC collection session interrupted'));

  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const owned: OwnedProcess[] = [];
  let previous: Awaited<ReturnType<typeof inspectServices>>;
  let borrowed = false;
  let failure: unknown;

  const report = {
    directory,
    database: resolve(directory, 'world.sqlite'),
    output,
    startedAt: new Date().toISOString(),
    stages: [] as { name: string; at: string }[],
    restoredWatcher: null as { pid: number; log: string } | null,
    error: null as string | null,
    cleanupErrors: [] as string[],
    complete: false,
  };

  const stage = async (name: string) => {
    console.log(name);
    report.stages.push({ name, at: new Date().toISOString() });
    await mkdir(dirname(sessionReport), { recursive: true });
    await writeFile(sessionReport, JSON.stringify(report, null, 2) + '\n');
  };

  try {
    await stage(`Preparing isolated collection session: ${directory}`);
    previous = await inspectServices(root);

    if (previous.watcher) {
      await stage(
        `Temporarily stopping this checkout's Go watcher PID ${previous.watcher.pid}; its original configuration will be restored.`,
      );
      borrowed = true;
      await stopWatcher(previous.watcher);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_ENV: 'development',
      NODE_ENV: 'development',
      DATABASE_PATH: relative(root, report.database),
      BACKUP_DIRECTORY: resolve(directory, 'backups'),
      GOMEMLIMIT: '300MiB',
      GOGC: '100',
      GOEXPERIMENT: 'simd',
      GOFLAGS: '',
      NPC_BENCHMARK_SESSION: directory,
    };

    delete env.PORT;
    delete env.GAME_SERVER_URL;

    const start = async (
      command: string,
      args: string[],
      name: string,
      visible = false,
    ) => {
      controller.signal.throwIfAborted();

      const process = await startNPCProcess({
        command,
        args,
        cwd: root,
        env,
        log: resolve(directory, `${name}.log`),
        visible,
      });

      owned.push(process);
      return process;
    };

    await stage('Building current client and server…');
    await completed(
      await start('npm', ['run', 'build'], 'build'),
      controller.signal,
    );
    await stage('Resetting the private benchmark world once…');
    await completed(
      await start('npm', ['run', 'reset-world:local'], 'reset'),
      controller.signal,
    );
    const manifest = resolve(directory, 'fixture.json');
    const overlay = prepareNPCFixture({ directory, manifestPath: manifest });

    env.GOFLAGS = `"-overlay=${overlay}"`;
    env.NPC_BENCHMARK_FIXTURE = manifest;
    await stage(
      `Starting the NPC fixture watcher on port 3001; log: ${resolve(directory, 'server.log')}`,
    );
    await readyService(
      await start('npm', ['run', 'dev:server'], 'server'),
      3001,
      controller.signal,
    );

    if (!previous.frontend) {
      await stage('Starting Vite on port 3000…');
      await readyService(
        await start('npm', ['run', 'dev', '--', '--strictPort'], 'frontend'),
        3000,
        controller.signal,
      );
    } else {
      await stage(
        `Reusing this checkout's Vite PID ${previous.frontend} on port 3000.`,
      );
    }

    await stage(`Running NPC cases: ${options.scenarios.join(', ')}…`);
    await completed(
      await start(
        process.execPath,
        ['benchmarking/npc/run.ts', ...forwarded],
        'capture',
        true,
      ),
      controller.signal,
    );
    report.complete = true;
  } catch (error) {
    failure = error;
  } finally {
    const cleanupFailed = (error: unknown) => {
      failure ||= error;
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);

      report.cleanupErrors.push(message);
      console.error(`Session cleanup: ${message}`);
    };

    for (const child of owned.toReversed()) {
      try {
        await stopNPCProcess(child);
      } catch (error) {
        cleanupFailed(error);
      }
    }

    if (borrowed) {
      try {
        await stage(
          'Restoring the previous Go watcher and database configuration…',
        ).catch(cleanupFailed);
        const current = await localProcess(previous.watcher.pid).catch(
          (): null => null,
        );

        assert(
          !current ||
            current.state === 'Z' ||
            current.started !== previous.watcher.started,
          'The previous Go watcher is still running; a duplicate will not be started.',
        );
        assert(
          !(await listeners(3001)).length,
          'Port 3001 is still occupied; the previous watcher cannot safely be restored.',
        );

        const restored = await startNPCProcess({
          command: previous.watcher.executable,
          args: previous.watcher.args.slice(1),
          cwd: previous.watcher.cwd,
          env: previous.environment,
          log: resolve(directory, 'restored-watcher.log'),
        });

        let ready = false;

        try {
          await readyService(restored, 3001);
          ready = true;
        } catch (error) {
          await stopNPCProcess(restored);
          cleanupFailed(error);
        }

        if (ready) {
          restored.child.unref();

          report.restoredWatcher = {
            pid: restored.child.pid,
            log: restored.log,
          };

          await stage(
            `Restored Go watcher PID ${restored.child.pid}; log: ${restored.log}`,
          );
        }
      } catch (error) {
        cleanupFailed(error);
      }
    }

    report.error = failure
      ? failure instanceof Error
        ? failure.message
        : JSON.stringify(failure)
      : null;
    report.complete &&= !failure;

    try {
      await mkdir(dirname(sessionReport), { recursive: true });
      await writeFile(sessionReport, JSON.stringify(report, null, 2) + '\n');
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      await unlink(lockPath);
    }
  }

  console.log(`Session details: ${sessionReport}`);

  if (failure) {
    process.exitCode = controller.signal.aborted ? 130 : 1;
    throw failure;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runCollectionSession(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode ||= 1;
  });
}
