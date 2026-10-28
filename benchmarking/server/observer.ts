import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function localServerPid(pid?: number) {
  if (pid !== undefined) {
    if (!Number.isInteger(pid) || pid < 1) {
      throw new Error('Invalid server PID');
    }

    return pid;
  }

  const sockets = await execute('ss', ['-ltnp', 'sport = :3001']);
  const ids = [...sockets.stdout.matchAll(/pid=(\d+)/g)].map((match) =>
    Number(match[1]),
  );

  if (new Set(ids).size !== 1) {
    throw new Error('Cannot identify exactly one local server on port3001');
  }

  return ids[0];
}

export const parseMachineCpu = (text: string, cpuIds?: number[]) => {
  const cores = text
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^cpu(\d+)\s+(.+)$/);

      if (!match || (cpuIds && !cpuIds.includes(Number(match[1])))) return [];
      const values = match[2].trim().split(/\s+/).map(Number);

      if (
        values.length < 8 ||
        values.some((value) => !Number.isFinite(value) || value < 0)
      ) {
        throw new Error('Invalid Linux machine CPU counters');
      }

      return [{ id: Number(match[1]), values }];
    })
    .toSorted((a, b) => a.id - b.id);

  if (!cores.length || (cpuIds && cores.length !== cpuIds.length)) {
    throw new Error('Missing Linux machine CPU counters');
  }

  return cores;
};

export const machineCpuDelta = ({
  before,
  after,
  elapsedMs,
  clockTicks = 100,
}: {
  before: ReturnType<typeof parseMachineCpu>;
  after: ReturnType<typeof parseMachineCpu>;
  elapsedMs: number;
  clockTicks?: number;
}) => {
  if (
    before.map((core) => core.id).join(',') !==
      after.map((core) => core.id).join(',') ||
    !(elapsedMs > 0 && clockTicks > 0)
  ) {
    throw new Error('Machine CPU identity or interval changed');
  }

  const counters = Array.from({ length: 8 }, () => 0);

  after.forEach((core, index) =>
    core.values.slice(0, 8).forEach((value, mode) => {
      const change = value - before[index].values[mode];

      if (change < 0) throw new Error('Machine CPU counters reset');
      counters[mode] += (change * 1000) / clockTicks;
    }),
  );

  const userMs = counters[0] + counters[1];
  const systemMs = counters[2] + counters[5] + counters[6];
  const cpuMs = userMs + systemMs;

  return {
    elapsedMs,
    userMs,
    systemMs,
    cpuMs,
    cpuPercentOfOneCore: (cpuMs / elapsedMs) * 100,
    cpuPercentOfMachine: ((cpuMs / elapsedMs) * 100) / before.length,
    iowaitMs: counters[4],
    stealMs: counters[7],
  };
};

export const parseProcessStat = (text: string) => {
  const end = text.lastIndexOf(')');
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  const startedTicks = Number(fields[19]);

  if (
    end < 0 ||
    !Number.isInteger(pid) ||
    ![userTicks, systemTicks, startedTicks].every(Number.isFinite)
  ) {
    throw new Error('Invalid Linux process CPU statistics');
  }

  return { pid, userTicks, systemTicks, startedTicks };
};

export const processCpuDelta = ({
  before,
  after,
  elapsedMs,
  clockTicks = 100,
}: {
  before: ReturnType<typeof parseProcessStat>;
  after: ReturnType<typeof parseProcessStat>;
  elapsedMs: number;
  clockTicks?: number;
}) => {
  if (before.pid !== after.pid || before.startedTicks !== after.startedTicks) {
    throw new Error('The server process restarted during measurement');
  }

  if (!(elapsedMs > 0 && clockTicks > 0)) {
    throw new Error('Invalid CPU measurement interval');
  }

  const userMs = ((after.userTicks - before.userTicks) * 1000) / clockTicks;
  const systemMs =
    ((after.systemTicks - before.systemTicks) * 1000) / clockTicks;

  if (userMs < 0 || systemMs < 0) {
    throw new Error('Server CPU counters moved backward');
  }

  const cpuMs = userMs + systemMs;

  return {
    elapsedMs,
    userMs,
    systemMs,
    cpuMs,
    cpuPercentOfOneCore: (cpuMs / elapsedMs) * 100,
  };
};

type FlySeries = {
  metric: { cpu_id: string; mode: string; instance: string };
  values: [number, string][];
};

const flyCpuModes = [
  'user',
  'nice',
  'system',
  'irq',
  'softirq',
  'steal',
  'iowait',
];

export const parseFlyCpuSample = (series: FlySeries[], boundaryAt?: number) => {
  const modes = flyCpuModes;
  const selected = series.filter((entry) => modes.includes(entry.metric.mode));
  const machines = new Set(selected.map((entry) => entry.metric.instance));
  const cores = new Set(selected.map((entry) => entry.metric.cpu_id));

  if (
    machines.size !== 1 ||
    !cores.size ||
    selected.some((entry) => !entry.values.length)
  ) {
    throw new Error(
      'CPU metrics must identify exactly one nonempty Fly machine',
    );
  }

  const at =
    boundaryAt ?? Math.min(...selected.map((entry) => entry.values.at(-1)[0]));
  const ticks = Object.fromEntries(modes.map((mode) => [mode, 0]));
  const coreTicks: Record<string, Record<string, number>> = Object.create(null);
  const sampleTimes: Record<string, Record<string, number>> = Object.create(
    null,
  );
  const seen = new Set<string>();
  let earliestAt = at;

  for (const entry of selected) {
    const core = entry.metric.cpu_id;
    const mode = entry.metric.mode;
    const key = `${core}:${mode}`;

    if (!core || !entry.metric.instance || seen.has(key)) {
      throw new Error(
        'Fly CPU metric core/mode series are invalid or duplicated',
      );
    }

    seen.add(key);

    if (
      entry.values.some(
        ([time], index) =>
          !Number.isFinite(time) ||
          (index > 0 && time <= entry.values[index - 1][0]),
      )
    ) {
      throw new Error('Fly CPU sample timestamps must increase');
    }

    const sample = entry.values.findLast(([time]) => time <= at);
    const value = Number(sample?.[1]);

    if (!sample || at - sample[0] > 2 || !Number.isFinite(value) || value < 0) {
      throw new Error(
        'Fly CPU metric samples are incomplete or unsynchronized',
      );
    }

    coreTicks[core] ??= {};
    sampleTimes[core] ??= {};
    coreTicks[core][mode] = value;
    sampleTimes[core][mode] = sample[0];
    earliestAt = Math.min(earliestAt, sample[0]);
    ticks[mode] += value;
  }

  for (const core of cores) {
    if (
      modes.some(
        (mode) =>
          !selected.some(
            (entry) =>
              entry.metric.cpu_id === core && entry.metric.mode === mode,
          ),
      )
    ) {
      throw new Error('Fly CPU metric modes are missing');
    }
  }

  return {
    at,
    earliestAt,
    ticks,
    coreTicks,
    sampleTimes,
    coreIds: [...cores].sort(),
    cores: cores.size,
    machine: [...machines][0],
    boundaryUncertaintyMs: (at - earliestAt) * 1000,
    raw: series,
  };
};

export type CpuWindow = { start: number; end: number };

/*
 * Historical metrics must bracket an interval inside the observed steady
 * workload. Every core/mode uses the same exact scrape at each boundary.
 */
export const selectFlyCpuWindow = (series: FlySeries[], window: CpuWindow) => {
  if (
    !(
      Number.isFinite(window.start) &&
      Number.isFinite(window.end) &&
      window.end > window.start
    )
  ) {
    throw new Error('Invalid CPU measurement window');
  }

  const selected = series.filter((entry) =>
    flyCpuModes.includes(entry.metric.mode),
  );

  parseFlyCpuSample(series);
  const times = selected[0].values
    .map(([time]) => time)
    .filter(
      (time) =>
        time * 1000 >= window.start &&
        time * 1000 <= window.end &&
        selected.every((entry) =>
          entry.values.some(([other]) => other === time),
        ),
    );

  if (times.length < 2) return null;

  return {
    before: parseFlyCpuSample(series, times[0]),
    after: parseFlyCpuSample(series, times.at(-1)),
  };
};

export const flyCpuDelta = ({
  before,
  after,
}: {
  before: ReturnType<typeof parseFlyCpuSample>;
  after: ReturnType<typeof parseFlyCpuSample>;
}) => {
  if (
    before.machine !== after.machine ||
    before.coreIds.join(',') !== after.coreIds.join(',')
  ) {
    throw new Error('The Fly machine changed during measurement');
  }

  const elapsedMs = (after.at - before.at) * 1000;
  const delta = (mode: string) => (after.ticks[mode] - before.ticks[mode]) * 10;

  if (elapsedMs <= 0) {
    throw new Error('No new Fly CPU sample; use a longer measurement');
  }

  if (
    before.coreIds.some((core) =>
      flyCpuModes.some(
        (mode) => after.coreTicks[core][mode] < before.coreTicks[core][mode],
      ),
    )
  ) {
    throw new Error('Fly CPU counters reset during measurement');
  }

  const userMs = delta('user') + delta('nice');
  const systemMs = delta('system') + delta('irq') + delta('softirq');
  const cpuMs = userMs + systemMs;

  return {
    elapsedMs,
    userMs,
    systemMs,
    cpuMs,
    cpuPercentOfOneCore: (cpuMs / elapsedMs) * 100,
    cpuPercentOfMachine: ((cpuMs / elapsedMs) * 100) / before.cores,
    stealMs: delta('steal'),
    iowaitMs: delta('iowait'),
    sampleStartedAt: new Date(before.at * 1000).toISOString(),
    sampleEndedAt: new Date(after.at * 1000).toISOString(),
    boundaryUncertaintyMs:
      before.boundaryUncertaintyMs + after.boundaryUncertaintyMs,
    counterUnitMs: 10,
  };
};

export async function observeServerCpu({
  url,
  pid,
  flyApp,
  flyMachine,
  flyOrg = 'personal',
  steadySince,
  cpuIds,
}: {
  url: string;
  pid?: number;
  flyApp?: string;
  flyMachine?: string;
  flyOrg?: string;
  steadySince?: number;
  cpuIds?: number[];
}) {
  const target = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  const source = local ? 'local-machine-proc-stat' : 'fly-machine-cpu-metrics';

  try {
    if (local) {
      const clockTicks = Number(
        (await execute('getconf', ['CLK_TCK'])).stdout.trim(),
      );

      pid = await localServerPid(pid);

      const sample = async () => {
        const began = performance.now();
        const [processText, machineText] = await Promise.all([
          readFile(`/proc/${pid}/stat`, 'utf8'),
          readFile('/proc/stat', 'utf8'),
        ]);
        const stat = parseProcessStat(processText);
        const machine = parseMachineCpu(machineText, cpuIds);
        const ended = performance.now();

        return {
          stat,
          machine,
          at: (began + ended) / 2,
          uncertaintyMs: (ended - began) / 2,
        };
      };

      const before = await sample();

      const identity = {
        pid,
        clockTicks,
        logicalCpuIds: before.machine.map((core) => core.id),
        virtualCPUs: before.machine.length,
      };

      return {
        available: true,
        source,
        async finish(_window?: CpuWindow) {
          try {
            const after = await sample();

            const processCpu = processCpuDelta({
              before: before.stat,
              after: after.stat,
              elapsedMs: after.at - before.at,
              clockTicks,
            });

            return {
              available: true,
              source,
              identity,
              scope:
                'Linux machine busy CPU on the recorded logical CPUs, including the OS and any other processes scheduled there. User/nice/system/IRQ/softIRQ modes match Fly machine CPU; steal/iowait are separate. Generator processes are unrestricted and may overlap these CPUs. Hardware and background workloads still differ.',
              ...machineCpuDelta({
                before: before.machine,
                after: after.machine,
                elapsedMs: after.at - before.at,
                clockTicks,
              }),
              process: {
                available: true,
                source: 'local-process-proc-stat',
                ...processCpu,
                cpuCounterQuantizationBoundMs: 2000 / clockTicks,
                scope:
                  'Supplemental Go-process user/system CPU; excludes load clients and other processes. No equivalent live process counter is available with current SSH credentials.',
              },
              boundaryUncertaintyMs: before.uncertaintyMs + after.uncertaintyMs,
              counterTickMs: 1000 / clockTicks,
              cpuCounterQuantizationBoundMs:
                (5000 * before.machine.length) / clockTicks,
              samples: { before, after },
              measurement:
                'Cumulative selected-machine CPU counters over a monotonic local interval, with supplemental Go-process counters. Raw counters and read-boundary uncertainty are retained.',
              sampleStartedAt: new Date(
                performance.timeOrigin + before.at,
              ).toISOString(),
              sampleEndedAt: new Date(
                performance.timeOrigin + after.at,
              ).toISOString(),
            };
          } catch (error) {
            return {
              available: false,
              source,
              identity,
              reason:
                error instanceof Error
                  ? error.message
                  : 'CPU measurement failed',
            };
          }
        },
      };
    }

    if (pid) {
      throw new Error('A process PID is only supported for local CPU sampling');
    }

    flyApp ||=
      target.hostname === 'unicorn-mining.co' ? 'unicorn-mining-co' : undefined;

    if (!flyApp) {
      throw new Error('Cannot identify the deployed Fly application');
    }

    if (!/^[a-zA-Z0-9-]+$/.test(flyOrg)) {
      throw new Error('Invalid Fly organization slug');
    }

    const response = await execute(
      'fly',
      ['machine', 'list', '--json', '--app', flyApp],
      { timeout: 30000 },
    );

    const running = (
      JSON.parse(response.stdout) as {
        id: string;
        state: string;
        instance_id?: string;
        updated_at?: string;
        image?: string;
        image_ref?: {
          registry?: string;
          repository?: string;
          tag?: string;
          digest?: string;
          labels?: Record<string, string>;
        };
        config?: {
          image?: string;
          metadata?: Record<string, string>;
          env?: Record<string, string>;
        };
      }[]
    ).filter((entry) => entry.state === 'started');

    if (running.length !== 1 || (flyMachine && running[0].id !== flyMachine)) {
      throw new Error(
        'Public-target CPU benchmarks require exactly one matching running Fly machine',
      );
    }

    flyMachine = running[0].id;
    const machine = running[0];

    const build = {
      image: machine.config?.image ?? machine.image ?? null,
      imageRef: machine.image_ref
        ? {
            registry: machine.image_ref.registry,
            repository: machine.image_ref.repository,
            tag: machine.image_ref.tag,
            digest: machine.image_ref.digest,
          }
        : null,
      instanceId: machine.instance_id ?? null,
      updatedAt: machine.updated_at ?? null,
      metadata: Object.fromEntries(
        [
          'fly_release_id',
          'fly_release_version',
          'fly_platform_version',
          'fly_process_group',
        ].flatMap((key) =>
          machine.config?.metadata?.[key] !== undefined
            ? [[key, machine.config.metadata[key]]]
            : [],
        ),
      ),
      imageLabels: Object.fromEntries(
        [
          'org.opencontainers.image.revision',
          'org.opencontainers.image.version',
          'org.opencontainers.image.created',
        ].flatMap((key) =>
          machine.image_ref?.labels?.[key] !== undefined
            ? [[key, machine.image_ref.labels[key]]]
            : [],
        ),
      ),
      note: 'Image/build fields exposed by the existing read-only machine-list response; no environment variables or secrets are retained.',
    };

    const endpoint = new URL(
      `https://api.fly.io/prometheus/${flyOrg}/api/v1/query`,
    );

    endpoint.searchParams.set(
      'query',
      `fly_instance_cpu{app=${JSON.stringify(flyApp)},instance=${JSON.stringify(flyMachine)}}[2m]`,
    );

    const sample = async (timeoutMs = 20000) => {
      // Preparation can outlast a CLI-issued credential. Obtain a current
      // credential for each read without changing the recorded CPU window.
      const token = (
        await execute('fly', ['auth', 'token'], { timeout: 10000 })
      ).stdout.trim();
      const authorization = /^(FlyV1|Bearer) /.test(token)
        ? token
        : `${token.startsWith('fm2_') ? 'FlyV1' : 'Bearer'} ${token}`;

      const response = await fetch(endpoint, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Fly CPU metrics returned HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        status: string;
        data?: { result: FlySeries[] };
      };

      if (body.status !== 'success') {
        throw new Error('Fly CPU metrics query failed');
      }

      const sample = parseFlyCpuSample(body.data?.result || []);
      const ageMs = Date.now() - sample.at * 1000;

      if (ageMs > 45000 || ageMs < -5000) {
        throw new Error(
          'Fly CPU samples are stale or their clock is inconsistent',
        );
      }

      return { ...sample, ageMs };
    };

    const availability = await sample();

    const identity = {
      app: flyApp,
      machine: flyMachine,
      org: flyOrg,
      virtualCPUs: availability.cores,
      build,
      runtimeEnvironment: Object.fromEntries(
        ['GOMAXPROCS', 'GODEBUG', 'GOGC', 'GOMEMLIMIT'].flatMap((key) =>
          machine.config?.env?.[key] !== undefined
            ? [[key, machine.config.env[key]]]
            : [],
        ),
      ),
      effectiveGOGC: machine.config?.env?.GOGC ?? '100',
      gcDefault:
        'When GOGC is unset, Go uses its default GC percentage of 100. Machine metadata records the configured environment, not a runtime introspection endpoint.',
    };

    return {
      available: true,
      source,
      async finish(window?: CpuWindow) {
        try {
          if (
            !window ||
            (steadySince !== undefined && window.start < steadySince)
          ) {
            throw new Error(
              'Live CPU sampling requires an explicit window after workload readiness',
            );
          }

          const began = performance.now();
          const deadline = began + 45000;
          let selected: ReturnType<typeof selectFlyCpuWindow>;
          let response: Awaited<ReturnType<typeof sample>>;

          do {
            response = await sample(
              Math.max(1, Math.min(20000, deadline - performance.now())),
            );
            selected = selectFlyCpuWindow(response.raw, window);

            if (selected) break;

            if (performance.now() >= deadline) {
              throw new Error(
                'Fewer than two common Fly CPU scrapes fell inside the active measurement window; no CPU result is reported. Use a 30-second or longer supported window.',
              );
            }

            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(3000, deadline - performance.now())),
            );
          } while (!selected);

          const { before, after } = selected;

          return {
            available: true,
            source,
            identity,
            scope:
              'Whole Fly machine CPU, including the OS; compare only matching CPU sources. Two common raw scrapes wholly inside the recorded active window delimit the CPU interval, which can be a subset of the client measurement. Delayed queries do not include post-window CPU.',
            ...flyCpuDelta({ before, after }),
            requestedWindow: window,
            coverageFraction:
              ((after.at - before.at) * 1000) / (window.end - window.start),
            waitedForMetricsMs: performance.now() - began,
            queryLatestSampleAgeMs: response.ageMs,
            samples: { before, after },
          };
        } catch (error) {
          return {
            available: false,
            source,
            identity,
            reason:
              error instanceof Error ? error.message : 'CPU measurement failed',
          };
        }
      },
    };
  } catch (error) {
    return {
      available: false,
      source,
      async finish(_window?: CpuWindow) {
        return {
          available: false,
          source,
          reason:
            error instanceof Error ? error.message : 'CPU measurement failed',
        };
      },
    };
  }
}
