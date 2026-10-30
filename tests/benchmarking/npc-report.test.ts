import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectionProgress,
  readNPCReport,
  summarizeNPCCollection,
  validateNPCActivity,
} from '../../benchmarking/npc/report.ts';

const launch = { at: 1000, kind: 'launch', itemId: 0 };
const events = [
  launch,
  { at: 2000, kind: 'pickup', itemId: 1 },
  { at: 3000, kind: 'external-pickup', itemId: 2 },
  { at: 4000, kind: 'pickup', itemId: 1 },
];

assert.deepEqual(collectionProgress({ items: 2, events }), {
  items: 2,
  pickedUp: 1,
  complete: false,
  pickupSeconds: [1],
  t50Seconds: 1,
  t90Seconds: null,
  completionSeconds: null,
});

assert.deepEqual(
  collectionProgress({
    items: 2,
    events: [...events, { at: 5500, kind: 'pickup', itemId: 2 }],
  }),
  {
    items: 2,
    pickedUp: 2,
    complete: true,
    pickupSeconds: [1, 4.5],
    t50Seconds: 1,
    t90Seconds: 4.5,
    completionSeconds: 4.5,
  },
);

assert.equal(collectionProgress({ items: 0, events: [] }).complete, true);

assert.equal(
  collectionProgress({
    items: 1,
    events: [{ at: 2000, kind: 'pickup', itemId: 1 }],
  }).completionSeconds,
  null,
);

// Retain slow or stuck workers for inspection while rejecting invalid fixtures.
for (const scenario of [
  'collection-courser',
  'collection-finch',
  'collector-crowded',
]) {
  assert.doesNotThrow(() =>
    validateNPCActivity({
      scenario,
      maximumActive: 1,
      events: [{ kind: 'launch' }],
      captureEvents: [],
    }),
  );

  assert.throws(() =>
    validateNPCActivity({
      scenario,
      maximumActive: 0,
      events: [],
      captureEvents: [],
    }),
  );
}

assert.throws(() =>
  validateNPCActivity({
    scenario: 'collector-idle',
    maximumActive: 1,
    events: [],
    captureEvents: [],
  }),
);

const outcome = (times: number[]) => ({
  collection: collectionProgress({
    items: 2,
    events: [
      launch,
      ...times.map((seconds, index) => ({
        at: launch.at + seconds * 1000,
        kind: 'pickup',
        itemId: index + 1,
      })),
    ],
  }),
});

const summaries = summarizeNPCCollection({
  scenarios: ['collection-courser', 'collection-finch', 'collector-empty'],
  repetitions: 10,
  results: [
    {
      scenario: 'collection-courser',
      authoritativeCollection: outcome([2, 4]),
    },
    {
      scenario: 'collection-courser',
      authoritativeCollection: outcome([3, 8]),
    },
    { scenario: 'collection-courser', authoritativeCollection: outcome([5]) },
    { scenario: 'collection-courser', authoritativeCollection: null },
    { scenario: 'collector-empty' },
  ],
});

assert.deepEqual(summaries, [
  {
    scenario: 'collection-courser',
    requestedRuns: 10,
    runs: 4,
    completedRuns: 2,
    completionRate: 0.5,
    meanCollectedFraction: 0.625,
    completionSeconds: { samples: 2, mean: 6, median: 6, min: 4, max: 8 },
    t50Seconds: { samples: 3, mean: 10 / 3, median: 3, min: 2, max: 5 },
    t90Seconds: { samples: 2, mean: 6, median: 6, min: 4, max: 8 },
  },
  {
    scenario: 'collection-finch',
    requestedRuns: 10,
    runs: 0,
    completedRuns: 0,
    completionRate: null,
    meanCollectedFraction: null,
    completionSeconds: {
      samples: 0,
      mean: null,
      median: null,
      min: null,
      max: null,
    },
    t50Seconds: { samples: 0, mean: null, median: null, min: null, max: null },
    t90Seconds: { samples: 0, mean: null, median: null, min: null, max: null },
  },
]);

const incomplete = summarizeNPCCollection({
  scenarios: ['collection-finch'],
  repetitions: 2,
  results: [
    { scenario: 'collection-finch', authoritativeCollection: outcome([1]) },
    { scenario: 'collection-finch' },
  ],
})[0];

assert.equal(incomplete.runs, 2);
assert.equal(incomplete.completionRate, 0);
assert.equal(incomplete.meanCollectedFraction, 0.25);
assert.equal(incomplete.completionSeconds.samples, 0);
assert.equal(incomplete.completionSeconds.mean, null);

const directory = await mkdtemp(join(tmpdir(), 'npc-report-test-'));
const previousManifest = process.env.NPC_BENCHMARK_FIXTURE;

try {
  process.env.NPC_BENCHMARK_FIXTURE = join(directory, 'fixture.json');
  await writeFile(
    process.env.NPC_BENCHMARK_FIXTURE,
    JSON.stringify({ directory }),
  );

  await writeFile(
    join(directory, 'npc-1.json'),
    JSON.stringify({
      scenario: 'collection-finch',
      seed: 42,
      layout: [{ x: -200, y: 300 }],
      items: 2,
      maximumActive: 1,
      deposited: 0,
      events: [
        { At: 1000, Kind: 'launch', ShipID: 1, ItemID: 0 },
        { At: 1500, Kind: 'pickup', ShipID: 1, ItemID: 10 },
        { At: 2500, Kind: 'pickup', ShipID: 1, ItemID: 11 },
      ],
    }),
  );

  const request = {
    shipId: 1,
    scenario: 'collection-finch',
    seed: 42,
    start: 1000,
    end: 2000,
  };

  const report = await readNPCReport(request);

  assert.equal(report.seed, 42);
  assert.deepEqual(report.layout, [{ x: -200, y: 300 }]);
  assert.equal(report.events.length, 3);
  assert.equal(report.captureEvents.length, 2);
  assert.equal(report.collection.pickedUp, 1);
  assert.equal(report.collection.complete, false);
  assert.equal(report.collection.t50Seconds, 0.5);
  assert.equal(report.collection.completionSeconds, null);

  const missingLaunch = await readNPCReport({ ...request, start: 1001 });

  assert.equal(missingLaunch.collection.pickedUp, 1);
  assert.equal(missingLaunch.collection.t50Seconds, null);

  await assert.rejects(
    readNPCReport({ ...request, seed: 43 }),
    /must match the requested layout seed/,
  );
  await assert.rejects(
    readNPCReport({ ...request, seed: undefined }),
    /require the requested layout seed/,
  );

  await writeFile(
    join(directory, 'npc-2.json'),
    JSON.stringify({
      scenario: 'collector',
      seed: null,
      layout: null,
      items: 2,
      maximumActive: 1,
      deposited: 0,
      events: report.events.map((event) => ({
        At: event.at,
        Kind: event.kind,
        ShipID: event.shipId,
        ItemID: event.itemId,
      })),
    }),
  );

  const ordinary = await readNPCReport({
    shipId: 2,
    scenario: 'collector',
    start: 1000,
    end: 2000,
  });

  assert.equal(ordinary.collection.complete, true);
  assert.equal(ordinary.collection.completionSeconds, 1.5);
} finally {
  if (previousManifest === undefined) {
    delete process.env.NPC_BENCHMARK_FIXTURE;
  } else {
    process.env.NPC_BENCHMARK_FIXTURE = previousManifest;
  }

  await rm(directory, { recursive: true, force: true });
}

assert.throws(() =>
  validateNPCActivity({
    scenario: 'collector',
    maximumActive: 1,
    events: [{ kind: 'launch' }],
    captureEvents: [],
  }),
);
