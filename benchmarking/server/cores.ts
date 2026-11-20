import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import { parseProcessStat } from './observer.ts';

const execute = promisify(execFile);

export type ServerRuntime = 'go' | 'rust';

export const parseCpuList = (text: string) => {
  const result = new Set<number>();

  for (const part of text.trim().split(',')) {
    assert(/^\d+(?:-\d+)?$/.test(part), 'Invalid Linux CPU list');
    const [start, last = start] = part.split('-').map(Number);

    assert(last >= start && last < 100000, 'Invalid Linux CPU range');

    for (let cpu = start; cpu <= last; cpu++) result.add(cpu);
  }

  return [...result].sort((a, b) => a - b);
};

export const selectServerCpus = (allowed: number[], count: number) => {
  assert(
    Number.isInteger(count) && count > 0,
    '--cores must be a positive integer',
  );
  assert(
    count <= allowed.length,
    `--cores ${count} exceeds the running server's ${allowed.length} allowed logical CPUs`,
  );
  return allowed.slice(0, count);
};

async function cgroupMemoryLimits(pid: number) {
  const groups = await readFile(`/proc/${pid}/cgroup`, 'utf8');
  const group = groups.match(/^0::(\/[^\n]*)$/m)?.[1];

  if (!group) return null;

  const limits: Record<string, string> = {};
  const root = '/sys/fs/cgroup';
  let current = join(root, group);

  while (current === root || current.startsWith(`${root}/`)) {
    const limit = await readFile(join(current, 'memory.max'), 'utf8').catch(
      (): null => null,
    );

    if (limit !== null) {
      limits[current.slice(root.length) || '/'] = limit.trim();
    }

    if (current === root) break;
    current = dirname(current);
  }

  const byteLimits = Object.values(limits)
    .filter((limit) => /^\d+$/.test(limit))
    .map(Number);

  return {
    group,
    limits,
    effectiveLimitBytes: byteLimits.length ? Math.min(...byteLimits) : null,
  };
}

/* New threads inherit their creator's affinity. Restore the threads that
 * existed when the run began and give later threads the original main mask.
 */
export async function limitServerCores({
  pid,
  count,
  runtime,
}: {
  pid: number;
  count?: number;
  runtime?: ServerRuntime;
}) {
  const started = parseProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
  const masks = new Map<string, number[]>();

  const status = async (tid: string) => {
    const text = await readFile(`/proc/${pid}/task/${tid}/status`, 'utf8');
    const list = text.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];

    assert(list, `Cannot read CPU affinity for server thread ${tid}`);
    return parseCpuList(list);
  };

  for (const tid of await readdir(`/proc/${pid}/task`)) {
    try {
      masks.set(tid, await status(tid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const original = masks.get(String(pid));

  assert(original?.length, 'Cannot identify the server main-thread affinity');
  const selected =
    count === undefined ? original : selectServerCpus(original, count);
  const environment = (await readFile(`/proc/${pid}/environ`, 'utf8')).split(
    '\0',
  );

  const rust = runtime === 'rust';
  const environmentKeys = rust
    ? /^(TOKIO_WORKER_THREADS|MALLOC_ARENA_MAX|GLIBC_TUNABLES)=/
    : /^(GOMAXPROCS|GODEBUG|GOGC|GOMEMLIMIT)=/;

  const runtimeEnvironment = Object.fromEntries(
    environment
      .filter((entry) => environmentKeys.test(entry))
      .map((entry) => {
        const index = entry.indexOf('=');

        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );

  const goBuild = !rust
    ? await execute('go', ['version', '-m', `/proc/${pid}/exe`]).then(
        ({ stdout }) =>
          stdout
            .split('\n')
            .filter(
              (line, index) =>
                index === 0 || /DefaultGODEBUG=|\bcompiler=/.test(line),
            ),
        (): null => null,
      )
    : null;

  if (runtime === 'go') {
    assert.match(
      goBuild?.[0] ?? '',
      /:\s+go\d+\./,
      '--runtime go requires a Go server listening on port 3001',
    );
  }

  let rustBuild;

  if (rust) {
    const path = `/proc/${pid}/exe`;
    const executable = await readlink(path);

    assert(
      ['unicorn-mining-server', 'server-rust'].includes(basename(executable)),
      '--runtime rust requires the native Rust server listening on port 3001',
    );
    const { stdout } = await execute('sha256sum', [path]);

    rustBuild = {
      executable,
      sha256: stdout.trim().split(/\s+/)[0],
    };
  }

  let memoryBudget;

  if (runtime) {
    const [limits, cgroupMemory] = await Promise.all([
      readFile(`/proc/${pid}/limits`, 'utf8'),
      cgroupMemoryLimits(pid),
    ]);

    memoryBudget = {
      addressSpaceLimit:
        limits.match(/^Max address space\s+(\S+)/m)?.[1] ?? null,
      cgroupMemory,
    };
  }

  let changed = false;

  const restore = async () => {
    if (!changed) return;
    const current = parseProcessStat(
      await readFile(`/proc/${pid}/stat`, 'utf8'),
    );

    assert.equal(
      current.startedTicks,
      started.startedTicks,
      'Refusing to restore affinity on a replacement server process',
    );
    await execute('taskset', ['-apc', original.join(','), String(pid)]);

    for (const tid of await readdir(`/proc/${pid}/task`)) {
      try {
        await execute('taskset', [
          '-pc',
          (masks.get(tid) || original).join(','),
          tid,
        ]);
      } catch (error) {
        if (
          await readFile(`/proc/${pid}/task/${tid}/status`, 'utf8').then(
            () => true,
            () => false,
          )
        ) {
          throw error;
        }
      }
    }

    changed = false;
  };

  try {
    if (count !== undefined) {
      changed = true;
      await execute('taskset', ['-apc', selected.join(','), String(pid)]);

      for (const tid of await readdir(`/proc/${pid}/task`)) {
        try {
          assert.deepEqual(
            await status(tid),
            selected,
            `Server thread ${tid} did not adopt the requested CPU limit`,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }

      // Keep the pre-preparation settling interval for both runtimes.
      await pause(1500);
    }
  } catch (error) {
    await restore();
    throw error;
  }

  return {
    metadata: {
      pid,
      requested: count ?? null,
      logicalCpuIds: selected,
      originalMainThreadCpuIds: original,
      originalThreadAffinities: Object.fromEntries(masks),
      runtimeEnvironment,
      effectiveGOGC: rust ? null : (runtimeEnvironment.GOGC ?? '100'),
      gcDefault: rust
        ? null
        : 'When GOGC is unset, Go uses its default GC percentage of 100; an environment value overrides that default.',
      goBuild,
      ...(rustBuild && { rustBuild }),
      ...(memoryBudget && { memoryBudget }),
      generatorAffinityChanged: false,
      scheduler: rust
        ? 'Tokio worker threads are created at startup. The recorded operating-system affinity limits all of the server threads.'
        : runtimeEnvironment.GOMAXPROCS ||
            /(?:^|,)(?:updatemaxprocs|containermaxprocs)=0(?:,|$)/.test(
              runtimeEnvironment.GODEBUG || '',
            )
          ? 'An explicit Go runtime setting may keep GOMAXPROCS unchanged; OS affinity still limits execution to the recorded CPUs.'
          : 'Current Go defaults update GOMAXPROCS from CPU affinity. A 1.5-second settling interval precedes preparation. The binary build version is retained. The benchmark does not sample runtime GOMAXPROCS directly.',
    },
    restore,
  };
}
