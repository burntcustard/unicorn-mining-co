import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parseProcessStat } from './observer.ts';

const execute = promisify(execFile);

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

/*
 * Change only the existing Go process. New Go threads inherit a restricted
 * thread's mask; restoration also covers those created during the suite.
 */
export async function limitServerCores({
  pid,
  count,
}: {
  pid: number;
  count?: number;
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

  const runtimeEnvironment = Object.fromEntries(
    environment
      .filter((entry) => /^(GOMAXPROCS|GODEBUG|GOGC|GOMEMLIMIT)=/.test(entry))
      .map((entry) => {
        const index = entry.indexOf('=');

        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );

  const goBuild = await execute('go', [
    'version',
    '-m',
    `/proc/${pid}/exe`,
  ]).then(
    ({ stdout }) =>
      stdout
        .split('\n')
        .filter(
          (line, index) =>
            index === 0 || /DefaultGODEBUG=|\bcompiler=/.test(line),
        ),
    (): null => null,
  );

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

      // Default Go GOMAXPROCS observes affinity changes at most once/second.
      await new Promise((resolve) => setTimeout(resolve, 1500));
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
      effectiveGOGC: runtimeEnvironment.GOGC ?? '800',
      gcDefault:
        'When GOGC is unset, src/server/main.go sets the GC percentage to800; an environment value overrides that source default.',
      goBuild,
      generatorAffinityChanged: false,
      scheduler:
        runtimeEnvironment.GOMAXPROCS ||
        /(?:^|,)(?:updatemaxprocs|containermaxprocs)=0(?:,|$)/.test(
          runtimeEnvironment.GODEBUG || '',
        )
          ? 'An explicit Go runtime setting may keep GOMAXPROCS unchanged; OS affinity still limits execution to the recorded CPUs.'
          : 'Current Go defaults update GOMAXPROCS from CPU affinity; a1.5-second settling interval precedes preparation. The binary build version is retained; runtime GOMAXPROCS is not directly sampled.',
    },
    restore,
  };
}
