import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import type * as Vec from '../../src/client/utilities/vector.ts';

/*
 * Count confirmed pickups once per item. Missing targets or another actor's
 * pickups cannot make an incomplete collection look finished.
 */
export function collectionProgress({
  items,
  events,
}: {
  items: number;
  events: { at: number; kind: string; itemId: number }[];
}) {
  const startedAt = events.find((event) => event.kind === 'launch')?.at;
  const picked = new Set<number>();
  const times: number[] = [];

  for (const event of events) {
    if (event.kind !== 'pickup' || picked.has(event.itemId)) continue;
    picked.add(event.itemId);

    if (startedAt !== undefined) times.push((event.at - startedAt) / 1000);
  }

  const timeAt = (fraction: number) =>
    items > 0 ? (times[Math.ceil(items * fraction) - 1] ?? null) : null;

  return {
    items,
    pickedUp: picked.size,
    complete: picked.size === items,
    pickupSeconds: times,
    t50Seconds: timeAt(0.5),
    t90Seconds: timeAt(0.9),
    completionSeconds: timeAt(1),
  };
}

function collectionTimes(values: (number | null)[]) {
  const times = values
    .filter((value) => value !== null)
    .toSorted((a, b) => a - b);
  const samples = times.length;

  return {
    samples,
    mean: samples
      ? times.reduce((sum, value) => sum + value, 0) / samples
      : null,
    median: samples
      ? (times[Math.floor((samples - 1) / 2)] +
          times[Math.floor(samples / 2)]) /
        2
      : null,
    min: samples ? times[0] : null,
    max: samples ? times[samples - 1] : null,
  };
}

/*
 * Every recorded run stays in the success and collected-fraction denominators,
 * including runs without an authoritative outcome. Completion times describe
 * completed runs only; each time statistic includes its actual sample count.
 */
export function summarizeNPCCollection({
  scenarios,
  repetitions,
  results,
}: {
  scenarios: string[];
  repetitions: number;
  results: {
    scenario: string;
    authoritativeCollection?: {
      collection: ReturnType<typeof collectionProgress>;
    } | null;
  }[];
}) {
  return scenarios
    .filter((scenario) => scenario.startsWith('collection-'))
    .map((scenario) => {
      const runs = results.filter((result) => result.scenario === scenario);
      const outcomes = runs.map(
        (run) => run.authoritativeCollection?.collection,
      );
      const completed = outcomes.filter((outcome) => outcome?.complete);

      return {
        scenario,
        requestedRuns: repetitions,
        runs: runs.length,
        completedRuns: completed.length,
        completionRate: runs.length ? completed.length / runs.length : null,
        meanCollectedFraction: runs.length
          ? outcomes.reduce(
              (sum, outcome) =>
                sum +
                (outcome && outcome.items > 0
                  ? outcome.pickedUp / outcome.items
                  : 0),
              0,
            ) / runs.length
          : null,
        completionSeconds: collectionTimes(
          completed.map((outcome) => outcome.completionSeconds),
        ),
        t50Seconds: collectionTimes(
          outcomes.map((outcome) => outcome?.t50Seconds ?? null),
        ),
        t90Seconds: collectionTimes(
          outcomes.map((outcome) => outcome?.t90Seconds ?? null),
        ),
      };
    });
}

/*
 * The compiler fixture writes after disconnect so disk I/O cannot affect the
 * measured window. Keep both the complete encounter and window-specific work.
 */
export async function readNPCReport({
  shipId,
  scenario,
  seed,
  start,
  end,
}: {
  shipId: number;
  scenario: string;
  seed?: number;
  start: number;
  end: number;
}) {
  const manifest = JSON.parse(
    await readFile(
      process.env.NPC_BENCHMARK_FIXTURE ||
        'benchmarking/_local/npc-fixture.json',
      'utf8',
    ),
  ) as { directory: string };

  const source = join(manifest.directory, `npc-${shipId}.json`);
  const deadline = Date.now() + 3000;

  let data: {
    scenario: string;
    seed: number | null;
    layout: Vec.Value[] | null;
    items: number;
    maximumActive: number;
    deposited: number;
    events: { At: number; Kind: string; ShipID: number; ItemID: number }[];
  };

  for (;;) {
    try {
      data = JSON.parse(await readFile(source, 'utf8')) as typeof data;
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await pause(100);
    }
  }

  assert.equal(
    data.scenario,
    scenario,
    'The authoritative fixture must match the captured scenario',
  );

  if (scenario.startsWith('collection-')) {
    assert(
      Number.isInteger(seed),
      'Collection reports require the requested layout seed',
    );
    assert.equal(
      data.seed,
      seed,
      'The authoritative fixture must match the requested layout seed',
    );
  }

  const events = (data.events || []).map((event) => ({
    at: event.At,
    kind: event.Kind,
    shipId: event.ShipID,
    itemId: event.ItemID,
  }));

  const captureEvents = events.filter(
    (event) => event.at >= start && event.at <= end,
  );

  validateNPCActivity({
    scenario,
    maximumActive: data.maximumActive,
    events,
    captureEvents,
  });

  return {
    ...data,
    events,
    captureEvents,
    collection: collectionProgress({
      items: data.items,
      events: scenario.startsWith('collection-') ? captureEvents : events,
    }),
    source,
  };
}

export function validateNPCActivity({
  scenario,
  maximumActive,
  events,
  captureEvents,
}: {
  scenario: string;
  maximumActive: number;
  events: { kind: string }[];
  captureEvents: { kind: string }[];
}) {
  if (
    scenario === 'collector' ||
    scenario === 'collector-crowded' ||
    scenario.startsWith('collection-')
  ) {
    assert(maximumActive > 0, 'The active fixture must launch real NPCs');

    if (scenario === 'collector') {
      assert(
        captureEvents.some((event) => event.kind === 'pickup'),
        'The measured window must include authoritative NPC pickups',
      );
    }
  } else {
    assert.equal(
      maximumActive,
      0,
      'An idle fixture must not launch collectors',
    );
    assert.equal(
      events.length,
      0,
      'An idle fixture must not collect its items',
    );
  }
}
