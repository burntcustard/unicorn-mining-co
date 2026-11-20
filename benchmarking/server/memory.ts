import assert from 'node:assert/strict';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseProcessStat } from './observer.ts';

const samplingIntervalMs = 1000;
const cgroupRoot = '/sys/fs/cgroup';
const memoryStatFields = [
  'anon',
  'file',
  'shmem',
  'kernel',
  'sock',
  'inactive_file',
  'active_file',
  'slab_reclaimable',
  'file_dirty',
  'file_writeback',
  'pgscan',
  'pgsteal',
  'workingset_refault_file',
];
const memoryEventFields = [
  'low',
  'high',
  'max',
  'oom',
  'oom_kill',
  'oom_group_kill',
  'sock_throttled',
];
const cpuStatFields = [
  'usage_usec',
  'user_usec',
  'system_usec',
  'nr_periods',
  'nr_throttled',
  'throttled_usec',
  'nr_bursts',
  'burst_usec',
];

type MemoryPhase = {
  phase: 'startup' | 'preparation' | 'measurement' | 'cleanup' | 'standalone';
  players?: number;
  workload?: string;
  repetition?: number;
};

const readText = (path: string) =>
  readFile(path, 'utf8').then(
    (value) => value.trim(),
    (): null => null,
  );

const parseCounter = (value: string | null) =>
  value !== null && /^\d+$/.test(value) ? Number(value) : null;

const selectCounters = (text: string | null, fields: string[]) => {
  const values = Object.fromEntries(
    (text ?? '').split('\n').map((line) => line.split(/\s+/)),
  );

  return Object.fromEntries(
    fields.map((field) => [field, parseCounter(values[field] ?? null)]),
  );
};

const pressureTotal = (text: string | null, kind: 'some' | 'full') => {
  const line = text?.split('\n').find((value) => value.startsWith(`${kind} `));

  return parseCounter(line?.match(/\btotal=(\d+)/)?.[1] ?? null);
};

const cgroupDirectory = (group: string) => {
  assert(
    group.startsWith('/') && !group.split('/').includes('..'),
    'Use an absolute cgroup path relative to /sys/fs/cgroup',
  );

  return join(cgroupRoot, group);
};

const processCgroup = (text: string | null) =>
  text?.match(/^0::(\/[^\n]*)$/m)?.[1] ?? null;

const pidList = (text: string | null) =>
  text === null
    ? null
    : text
        .split(/\s+/)
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0)
        .toSorted((a, b) => a - b);

const statusBytes = (text: string | null, label: string) => {
  const value = text?.match(new RegExp(`^${label}:\\s+(\\d+) kB$`, 'm'));

  return value ? Number(value[1]) * 1024 : null;
};

const readCgroup = async (group: string) => {
  const path = cgroupDirectory(group);
  const fields = [
    'memory.current',
    'memory.peak',
    'memory.max',
    'memory.high',
    'memory.stat',
    'memory.events',
    'memory.swap.current',
    'memory.swap.peak',
    'memory.swap.max',
    'memory.pressure',
    'cpu.max',
    'cpu.max.burst',
    'cpu.stat',
    'cgroup.procs',
  ];
  const values = Object.fromEntries(
    await Promise.all(
      fields.map(async (field) => [field, await readText(join(path, field))]),
    ),
  );
  const pressure = values['memory.pressure'];

  return {
    group,
    pids: pidList(values['cgroup.procs']),
    memory: {
      currentBytes: parseCounter(values['memory.current']),
      lifetimePeakBytes: parseCounter(values['memory.peak']),
      max: values['memory.max'],
      high: values['memory.high'],
      stats: selectCounters(values['memory.stat'], memoryStatFields),
      events: selectCounters(values['memory.events'], memoryEventFields),
      swap: {
        currentBytes: parseCounter(values['memory.swap.current']),
        lifetimePeakBytes: parseCounter(values['memory.swap.peak']),
        max: values['memory.swap.max'],
      },
      pressure: {
        someTotalUs: pressureTotal(pressure, 'some'),
        fullTotalUs: pressureTotal(pressure, 'full'),
      },
    },
    cpu: {
      max: values['cpu.max'],
      maxBurstUs: parseCounter(values['cpu.max.burst']),
      stats: selectCounters(values['cpu.stat'], cpuStatFields),
    },
  };
};

/* A sidecar timeline leaves the existing CPU window and qualification intact.
 * Kernel peaks retain startup even if sampling begins after the process is up.
 */
export const observeServerMemory = async ({
  pid,
  group,
  output,
}: {
  pid?: number;
  group?: string;
  output: string;
}) => {
  assert(process.platform === 'linux', 'Memory telemetry requires Linux');
  assert(pid || group, 'Provide the server PID or its cgroup');
  assert(
    pid === undefined || (Number.isInteger(pid) && pid > 0),
    'Invalid server PID',
  );

  if (group) cgroupDirectory(group);

  await mkdir(dirname(output), { recursive: true });
  const file = await open(output, 'wx');
  let phase: MemoryPhase = { phase: 'startup' };
  let startedTicks: number;
  let currentPid = pid;
  let currentGroup = group;
  let pending: Promise<void> | undefined;
  let stopped: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let failure: unknown;

  const snapshot = async () => {
    const at = Date.now();
    const currentPhase = phase;

    if (!currentPid && currentGroup) {
      const pids = pidList(
        await readText(join(cgroupDirectory(currentGroup), 'cgroup.procs')),
      );

      if (pids?.length === 1) currentPid = pids[0];
    }

    const [stat, status, actualGroup] = currentPid
      ? await Promise.all([
          readText(`/proc/${currentPid}/stat`).then((text) =>
            text === null ? null : parseProcessStat(text),
          ),
          readText(`/proc/${currentPid}/status`),
          readText(`/proc/${currentPid}/cgroup`).then(processCgroup),
        ])
      : [null, null, null];

    if (stat) startedTicks ??= stat.startedTicks;
    const sameProcess = stat !== null && stat.startedTicks === startedTicks;

    if (sameProcess && actualGroup) currentGroup ??= actualGroup;
    const cgroup = currentGroup ? await readCgroup(currentGroup) : null;
    const currentStatus = sameProcess ? status : null;

    await file.writeFile(
      JSON.stringify({
        at,
        ...currentPhase,
        process: {
          pid: currentPid ?? null,
          startedTicks: sameProcess ? startedTicks : null,
          group: sameProcess ? actualGroup : null,
          residentBytes: statusBytes(currentStatus, 'VmRSS'),
          residentAnonBytes: statusBytes(currentStatus, 'RssAnon'),
          residentFileBytes: statusBytes(currentStatus, 'RssFile'),
          residentShmemBytes: statusBytes(currentStatus, 'RssShmem'),
          lifetimePeakResidentBytes: statusBytes(currentStatus, 'VmHWM'),
          swapBytes: statusBytes(currentStatus, 'VmSwap'),
        },
        cgroup,
      }) + '\n',
    );
  };

  const sample = () => {
    pending ??= snapshot()
      .catch((error: unknown) => {
        failure = error;
        clearInterval(timer);
      })
      .finally(() => {
        pending = undefined;
      });

    return pending;
  };

  try {
    await file.writeFile(
      JSON.stringify({
        schema: 1,
        samplingIntervalMs,
        measurement:
          'Linux process status and cgroup v2 reads. Peaks are lifetime kernel high-water values. Null values are unavailable. Cgroup memory includes charged cache and kernel usage.',
      }) + '\n',
    );

    await sample();

    if (failure) throw failure;
    timer = setInterval(() => void sample(), samplingIntervalMs);
  } catch (error) {
    clearInterval(timer);
    await file.close();
    throw error;
  }

  return {
    setPhase(value: MemoryPhase) {
      phase = value;
    },
    stop() {
      if (stopped) return stopped;
      clearInterval(timer);

      stopped = (async () => {
        await pending;

        if (!failure) await sample();
        await file.close();

        if (failure) throw failure;
      })();

      return stopped;
    },
  };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      pid: { type: 'string' },
      cgroup: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (values.help) {
    console.log(
      'Usage: node benchmarking/server/memory.ts [--pid N] [--cgroup /PATH] --output FILE.jsonl',
    );
  } else {
    assert(values.output, 'Provide --output FILE.jsonl');

    const observer = await observeServerMemory({
      pid: values.pid === undefined ? undefined : Number(values.pid),
      group: values.cgroup,
      output: values.output,
    });

    observer.setPhase({ phase: 'standalone' });

    await new Promise<void>((done) => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });

    observer.setPhase({ phase: 'cleanup' });
    await observer.stop();
  }
}
