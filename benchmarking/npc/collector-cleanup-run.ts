import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { inspect, parseArgs } from 'node:util';
import {
  analyzeCollectorCleanup,
  cleanupCpuWindow,
  readCleanupSamples,
} from './collector-cleanup-analysis.ts';
import { limitServerCores } from '../server/cores.ts';
import { localServerPid, parseProcessStat } from '../server/observer.ts';

const { values } = parseArgs({
  options: {
    telemetry: { type: 'string' },
    cohort: {
      type: 'string',
      default: 'benchmarking/_local/collector-cleanup/cohort-in-range.json',
    },
    origin: {
      type: 'string',
      default: 'benchmarking/_local/collector-cleanup/disconnect.json',
    },
    seconds: { type: 'string', default: '1800' },
    'cpu-seconds': { type: 'string', default: '300' },
    'cpu-start-tick': { type: 'string' },
    'continue-cleanup': { type: 'boolean', default: false },
    'continue-deposit': { type: 'boolean', default: false },
    cores: { type: 'string', default: '2' },
    output: {
      type: 'string',
      default: 'benchmarking/_local/collector-cleanup/baseline-real.json',
    },
  },
});

const seconds = Number(values.seconds);
const cpuSeconds = Number(values['cpu-seconds']);
const cpuStartTick =
  values['cpu-start-tick'] === undefined
    ? undefined
    : Number(values['cpu-start-tick']);

assert(values.telemetry, 'Specify the passive telemetry JSONL path');
assert(
  Number.isFinite(seconds) && seconds > 0,
  'Specify a positive capture limit',
);
assert(
  Number.isFinite(cpuSeconds) && cpuSeconds > 0,
  'Specify a positive CPU window',
);
assert(
  cpuStartTick === undefined ||
    (Number.isSafeInteger(cpuStartTick) && cpuStartTick >= 0),
  'Specify an integer CPU starting tick',
);
const output = resolve(values.output);

const cohort = JSON.parse(await readFile(values.cohort, 'utf8')) as {
  sectorID: string;
  id: number;
}[];

const origin = JSON.parse(await readFile(values.origin, 'utf8')) as {
  tick: number;
  at: number;
};

await mkdir(dirname(output), { recursive: true });
let limits: Awaited<ReturnType<typeof limitServerCores>>;

const report = {
  benchmark: 'collector-cleanup-real-server',
  startedAt: Date.now(),
  endedAt: 0,
  maximumSeconds: seconds,
  cpuSeconds,
  cpuStartTick,
  continueCleanup: values['continue-cleanup'],
  continueDeposit: values['continue-deposit'],
  runtime: null as
    | Awaited<ReturnType<typeof limitServerCores>>['metadata']
    | null,
  telemetry: resolve(values.telemetry),
  cohort: resolve(values.cohort),
  origin,
  result: null as ReturnType<typeof analyzeCollectorCleanup> | null,
  matchedCpuWindow: null as ReturnType<typeof cleanupCpuWindow>,
  complete: false,
  deposited: false,
  error: null as string | null,
  measurement:
    'Passive five-second telemetry and normal simulation. Process CPU uses server-owned counters at exact matching simulation ticks; its percentage uses elapsed wall time. Cleanup simulation timings use the supplied origin tick; wall times from original disconnect include checkpoint downtime. Optional continuation after the fixed CPU window does not extend that CPU comparison.',
};

let interrupted = false;

const interrupt = () => {
  interrupted = true;
};

const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');

process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  limits = await limitServerCores({
    pid: await localServerPid(),
    count: Number(values.cores),
  });

  report.runtime = limits.metadata;
  assert.equal(
    limits.metadata.runtimeEnvironment.GOMEMLIMIT,
    '300MiB',
    'Match the live Go memory budget',
  );
  assert.equal(limits.metadata.effectiveGOGC, '100', 'Match live GOGC=100');
  await save();

  while (!interrupted) {
    const cpu = parseProcessStat(
      await readFile(`/proc/${limits.metadata.pid}/stat`, 'utf8'),
    );

    await appendFile(
      output + '.cpu.jsonl',
      JSON.stringify({ at: Date.now(), ...cpu }) + '\n',
    );
    const samples = readCleanupSamples(values.telemetry).filter(
      (sample) => sample.pid === limits.metadata.pid,
    );

    if (samples.length) {
      report.matchedCpuWindow ??= cleanupCpuWindow({
        samples,
        seconds: cpuSeconds,
        startTick: cpuStartTick,
      });

      report.result = analyzeCollectorCleanup({
        samples,
        cohort,
        originTick: origin.tick,
        originAt: origin.at,
      });

      const final = report.result.final;

      console.error(
        JSON.stringify({
          elapsedSeconds: (Date.now() - report.startedAt) / 1000,
          tick: final?.tick,
          remaining: final?.loose,
          collectorPickups: final?.collectorPickups,
          deposited: final?.deposited.length,
          unknown: final?.unknownIDs.length,
          activeCollectors: final?.activeCollectors,
          states: final?.states,
          queuedTrips: final?.queuedTrips,
          cpuWindowComplete: !!report.matchedCpuWindow,
        }),
      );

      if (
        report.result.collectorPickupThresholds.T100 &&
        final?.collectorHeldCount === cohort.length
      ) {
        report.complete = true;
      }

      report.deposited =
        report.complete && new Set(final?.deposited).size === cohort.length;

      await save();

      if (
        report.matchedCpuWindow &&
        (values['continue-deposit']
          ? report.deposited
          : !values['continue-cleanup'] || report.complete)
      ) {
        break;
      }
    }

    const remaining = seconds * 1000 - (Date.now() - report.startedAt);

    if (remaining <= 0) break;
    await pause(Math.min(5000, remaining));
  }

  if (!report.matchedCpuWindow && !interrupted) {
    throw new Error(
      'No complete CPU window at the requested exact simulation ticks',
    );
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : inspect(error);
} finally {
  report.endedAt = Date.now();

  try {
    await limits?.restore();
  } catch (error) {
    const message = error instanceof Error ? error.message : inspect(error);

    report.error = [report.error, `Affinity restoration: ${message}`]
      .filter(Boolean)
      .join('; ');
  }

  await save();
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

console.log(output);

if (report.error) process.exitCode = 1;
