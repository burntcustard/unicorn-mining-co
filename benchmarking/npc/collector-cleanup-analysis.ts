import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type CleanupItem = {
  id: number;
  position: unknown;
  sleeping: boolean;
  inOperatingRange: boolean;
};

type CleanupEvent = {
  at: number;
  tick: number;
  kind: string;
  itemID?: number;
  shipID?: number;
  actor?: string;
  initial?: boolean;
};

export type CleanupSample = {
  at: number;
  pid: number;
  tick: number;
  sectorID: string;
  simulationStep: number;
  connected: number;
  cpu?: { userMicros: number; systemMicros: number };
  items: CleanupItem[];
  events: CleanupEvent[] | null;
  collectors: {
    id: number;
    state: string;
    targetID: number;
    cargo: number[];
    position: unknown;
    inspect: unknown;
  }[];
  pirates: { id: number; cargo: number[] }[];
  players: {
    id: number;
    connected: boolean;
    hidden: boolean;
    cargo: number[];
  }[];
  stations: {
    id: number;
    checkAt: number;
    launchAt: number;
    seen: number[];
    queue: unknown[][] | null;
  }[];
  cargo: { id: number; kind: string; items: number[] }[];
};

/*
 * Match server-owned CPU counters at exact simulation ticks. Wall time remains
 * measured, so a delayed server cannot appear cheaper by completing less work.
 */
export function cleanupCpuWindow({
  samples,
  seconds,
  startTick,
}: {
  samples: CleanupSample[];
  seconds: number;
  startTick?: number;
}) {
  const first = samples.find(
    (sample) =>
      sample.cpu && (startTick === undefined || sample.tick === startTick),
  );

  if (!first) return null;
  const ticks = seconds / first.simulationStep;

  assert(
    Math.abs(ticks - Math.round(ticks)) < 1e-6,
    'CPU window must span whole simulation ticks',
  );
  const endTick = first.tick + Math.round(ticks);
  const last = samples.find(
    (sample) =>
      sample.cpu &&
      sample.pid === first.pid &&
      sample.sectorID === first.sectorID &&
      sample.tick === endTick,
  );

  if (!last) return null;
  const userMs = (last.cpu.userMicros - first.cpu.userMicros) / 1000;
  const systemMs = (last.cpu.systemMicros - first.cpu.systemMicros) / 1000;
  const elapsedMs = last.at - first.at;

  assert(
    userMs >= 0 && systemMs >= 0 && elapsedMs > 0,
    'Invalid server CPU counters',
  );

  return {
    pid: first.pid,
    sectorID: first.sectorID,
    startTick: first.tick,
    endTick,
    simulationSeconds: seconds,
    startedAt: first.at,
    endedAt: last.at,
    elapsedMs,
    userMs,
    systemMs,
    cpuMs: userMs + systemMs,
    cpuPercentOfOneCore: ((userMs + systemMs) / elapsedMs) * 100,
    before: first.cpu,
    after: last.cpu,
    humanConnectionsObserved: Math.max(
      ...samples
        .filter(
          (sample) =>
            sample.pid === first.pid &&
            sample.tick >= first.tick &&
            sample.tick <= endTick,
        )
        .map((sample) => sample.connected),
    ),
    scope:
      'Go process RUSAGE_SELF counters sampled inside the same server tick hook; includes passive telemetry overhead. Same tick interval and instrumentation are required for comparison.',
  };
}

/*
 * Ignore a trailing incomplete write while reading the live JSONL stream.
 */
export function readCleanupSamples(path: string): CleanupSample[] {
  const text = readFileSync(path, 'utf8');
  const end = text.lastIndexOf('\n');

  if (end < 0) return [];

  return text
    .slice(0, end)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CleanupSample);
}

/*
 * Keep the complete initial cohort fixed. Unknown disappearance does not count
 * as an observed pickup, and residual IDs remain visible even outside range.
 */
export function analyzeCollectorCleanup({
  samples,
  cohort,
  originTick,
  originAt,
}: {
  samples: CleanupSample[];
  cohort: { sectorID: string; id: number }[];
  originTick: number;
  originAt: number;
}) {
  assert(samples.length, 'No complete telemetry samples');
  assert.equal(
    new Set(samples.map((sample) => sample.pid)).size,
    1,
    'Telemetry contains multiple server processes; use a separate telemetry file for each run',
  );
  const sectors = new Set(cohort.map((item) => item.sectorID));

  assert.equal(sectors.size, 1, 'Use a separate report per sector');
  const sectorID = [...sectors][0];
  const sequence = samples.filter(
    (sample) => sample.sectorID === sectorID && sample.tick >= originTick,
  );
  const ids = new Set(cohort.map((item) => item.id));
  const pickups = new Map<number, CleanupEvent>();
  const firstCollectorPickups = new Map<number, CleanupEvent>();

  const timeline = sequence.map((sample) => {
    for (const event of sample.events || []) {
      if (event.kind !== 'pickup' || !ids.has(event.itemID)) continue;

      if (!pickups.has(event.itemID)) pickups.set(event.itemID, event);

      if (
        event.actor === 'collector' &&
        !firstCollectorPickups.has(event.itemID)
      ) {
        firstCollectorPickups.set(event.itemID, event);
      }
    }

    const loose = sample.items.filter((item) => ids.has(item.id));
    const collectorCargo = sample.collectors
      .flatMap((npc) => npc.cargo)
      .filter((id) => ids.has(id));
    const otherCargo = [...sample.pirates, ...sample.players]
      .flatMap((owner) => owner.cargo)
      .filter((id) => ids.has(id));
    const deposited = sample.cargo
      .flatMap((owner) => owner.items)
      .filter((id) => ids.has(id));
    const present = new Set([
      ...loose.map((item) => item.id),
      ...collectorCargo,
      ...otherCargo,
      ...deposited,
    ]);

    return {
      tick: sample.tick,
      simulationSeconds: (sample.tick - originTick) * sample.simulationStep,
      wallSeconds: (sample.at - originAt) / 1000,
      loose: loose.length,
      looseIDs: loose.map((item) => item.id),
      outsideOperatingRange: loose
        .filter((item) => !item.inOperatingRange)
        .map((item) => item.id),
      collectorCargo,
      collectorHeldCount: new Set([...collectorCargo, ...deposited]).size,
      otherCargo,
      deposited,
      unknownIDs: [...ids].filter((id) => !present.has(id)),
      observedPickups: pickups.size,
      collectorPickups: firstCollectorPickups.size,
      activeCollectors: sample.collectors.length,
      states: Object.fromEntries(
        [...new Set(sample.collectors.map((npc) => npc.state))].map((state) => [
          state,
          sample.collectors.filter((npc) => npc.state === state).length,
        ]),
      ),
      queuedTrips: sample.stations.reduce(
        (sum, station) => sum + (station.queue?.length || 0),
        0,
      ),
    };
  });

  const events = sequence.flatMap((sample) => sample.events || []);
  const firstLaunch = events.find(
    (event) => event.kind === 'collector-observed' && !event.initial,
  );
  const firstActiveTick = sequence[0]?.collectors.length
    ? originTick
    : firstLaunch?.tick;

  const thresholds = Object.fromEntries(
    [50, 90, 100].map((percentage) => {
      const needed = Math.ceil((ids.size * percentage) / 100);
      const sample = timeline.find((entry) => ids.size - entry.loose >= needed);

      return [
        `T${percentage}`,
        sample
          ? {
              tick: sample.tick,
              fromOriginSimulationSeconds: sample.simulationSeconds,
              fromOriginWallSeconds: sample.wallSeconds,
              fromFirstActiveSimulationSeconds:
                firstActiveTick === undefined
                  ? null
                  : (sample.tick - firstActiveTick) *
                    sequence[0].simulationStep,
              unknownIDs: sample.unknownIDs,
            }
          : null,
      ];
    }),
  );

  const collectorPickups = [...firstCollectorPickups.values()].toSorted(
    (a, b) => a.tick - b.tick,
  );

  const collectorPickupThresholds = Object.fromEntries(
    [50, 90, 100].map((percentage) => {
      const event =
        collectorPickups[Math.ceil((ids.size * percentage) / 100) - 1];

      return [
        `T${percentage}`,
        event
          ? {
              tick: event.tick,
              fromOriginSimulationSeconds:
                (event.tick - originTick) * sequence[0].simulationStep,
              fromOriginWallSeconds: (event.at - originAt) / 1000,
              fromFirstActiveSimulationSeconds:
                firstActiveTick === undefined
                  ? null
                  : (event.tick - firstActiveTick) * sequence[0].simulationStep,
            }
          : null,
      ];
    }),
  );

  const collectorHeldThresholds = Object.fromEntries(
    [50, 90, 100].map((percentage) => {
      const sample = timeline.find(
        (entry) =>
          entry.collectorHeldCount >= Math.ceil((ids.size * percentage) / 100),
      );

      return [
        `T${percentage}`,
        sample
          ? {
              tick: sample.tick,
              fromOriginSimulationSeconds: sample.simulationSeconds,
              fromFirstActiveSimulationSeconds:
                firstActiveTick === undefined
                  ? null
                  : (sample.tick - firstActiveTick) *
                    sequence[0].simulationStep,
            }
          : null,
      ];
    }),
  );

  return {
    sectorID,
    originTick,
    originAt,
    cohort,
    cohortCount: ids.size,
    firstActiveTick,
    thresholds,
    collectorPickupThresholds,
    collectorHeldThresholds,
    pickups: [...pickups.values()],
    collectorPickups,
    final: timeline.at(-1),
    finalItems: sequence.at(-1)?.items.filter((item) => ids.has(item.id)),
    finalCollectors: sequence.at(-1)?.collectors,
    timeline,
    measurement:
      'Five-second simulation snapshots bound remaining-item thresholds; pickup event ticks are exact. T100 means no initial-cohort items remain loose; unknown disappearance and noncollector pickup are reported separately. No outside-range IDs are silently removed.',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const samples = readCleanupSamples(process.argv[2]);
  const initial = samples.find((sample, index) =>
    samples
      .slice(0, index)
      .some((previous) => previous.connected - sample.connected >= 32),
  );

  assert(
    initial,
    'No disconnect transition removing at least 32 connected players yet',
  );

  const cohort = initial.items.map((item) => ({
    sectorID: initial.sectorID,
    id: item.id,
  }));

  const report = analyzeCollectorCleanup({
    samples,
    cohort,
    originTick: initial.tick,
    originAt: initial.at,
  });

  if (process.argv[3]) {
    writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  }

  console.log(
    JSON.stringify(
      {
        cohortCount: report.cohortCount,
        originTick: report.originTick,
        thresholds: report.thresholds,
        final: report.final,
        collectors: report.finalCollectors,
      },
      null,
      2,
    ),
  );
}
