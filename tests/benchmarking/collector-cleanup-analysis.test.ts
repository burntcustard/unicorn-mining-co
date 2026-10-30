import assert from 'node:assert/strict';
import {
  analyzeCollectorCleanup,
  cleanupCpuWindow,
  type CleanupSample,
} from '../../benchmarking/npc/collector-cleanup-analysis.ts';

const sample = (tick: number): CleanupSample => ({
  at: tick * 1000,
  pid: 10,
  tick,
  sectorID: 'test',
  simulationStep: 1,
  connected: 0,
  items: [],
  events: [],
  collectors: [],
  pirates: [],
  players: [],
  stations: [],
  cargo: [],
});

const initial = sample(100);

initial.items = [1, 2, 3].map((id) => ({
  id,
  position: { x: id, y: 0 },
  sleeping: false,
  inOperatingRange: id !== 3,
}));

const ending = sample(110);

ending.events = [
  {
    kind: 'collector-observed',
    tick: 102,
    at: 102000,
    shipID: 20,
    initial: false,
  },
  { kind: 'pickup', tick: 105, at: 105000, itemID: 1, actor: 'collector' },
  { kind: 'pickup', tick: 106, at: 106000, itemID: 2, actor: 'pirate' },
];

ending.collectors = [
  {
    id: 20,
    state: 'Returning',
    targetID: 0,
    cargo: [1],
    position: { x: 0, y: 0 },
    inspect: null,
  },
];

ending.pirates = [{ id: 21, cargo: [2] }];

const report = analyzeCollectorCleanup({
  samples: [initial, ending],
  cohort: initial.items.map(({ id }) => ({ sectorID: 'test', id })),
  originTick: initial.tick,
  originAt: initial.at,
});

assert.deepEqual(report.timeline[0].outsideOperatingRange, [3]);
assert.deepEqual(report.final.unknownIDs, [3]);
assert.equal(report.thresholds.T100.fromOriginSimulationSeconds, 10);
assert.equal(report.collectorPickupThresholds.T50, null);
assert.equal(report.collectorPickupThresholds.T100, null);
assert.equal(report.collectorHeldThresholds.T100, null);
assert.equal(report.final.collectorPickups, 1);

const later = sample(120);

later.events = [
  { kind: 'pickup', tick: 112, at: 112000, itemID: 2, actor: 'collector' },
  { kind: 'pickup', tick: 114, at: 114000, itemID: 3, actor: 'collector' },
];

const collectorOnly = analyzeCollectorCleanup({
  samples: [initial, ending, later],
  cohort: [
    { sectorID: 'test', id: 1 },
    { sectorID: 'test', id: 3 },
  ],
  originTick: initial.tick,
  originAt: initial.at,
});

assert.equal(
  collectorOnly.collectorPickupThresholds.T100.fromOriginSimulationSeconds,
  14,
);
assert.equal(
  collectorOnly.collectorPickupThresholds.T100.fromFirstActiveSimulationSeconds,
  12,
);
assert.equal(collectorOnly.collectorHeldThresholds.T100, null);

later.collectors = [{ ...ending.collectors[0], cargo: [1, 2, 3] }];

const recovered = analyzeCollectorCleanup({
  samples: [initial, ending, later],
  cohort: initial.items.map(({ id }) => ({ sectorID: 'test', id })),
  originTick: initial.tick,
  originAt: initial.at,
});

assert.equal(recovered.final.collectorPickups, 3);
assert.equal(
  recovered.collectorPickupThresholds.T100.fromOriginSimulationSeconds,
  14,
);
assert.equal(
  recovered.collectorHeldThresholds.T100.fromOriginSimulationSeconds,
  20,
);
assert.equal(
  recovered.pickups.find((event) => event.itemID === 2).actor,
  'pirate',
);
assert.equal(
  recovered.collectorPickups.find((event) => event.itemID === 2).tick,
  112,
);

assert.throws(
  () =>
    analyzeCollectorCleanup({
      samples: [initial, { ...ending, pid: 11 }],
      cohort: initial.items.map(({ id }) => ({ sectorID: 'test', id })),
      originTick: initial.tick,
      originAt: initial.at,
    }),
  /multiple server processes/,
);

const cpuStart = {
  ...sample(100),
  cpu: { userMicros: 1_000_000, systemMicros: 2_000_000 },
};

const cpuEnd = {
  ...sample(400),
  cpu: { userMicros: 3_000_000, systemMicros: 4_000_000 },
};

const cpu = cleanupCpuWindow({
  samples: [cpuStart, cpuEnd],
  seconds: 300,
  startTick: 100,
});

assert.equal(cpu.simulationSeconds, 300);
assert.equal(cpu.elapsedMs, 300000);
assert.equal(cpu.cpuMs, 4000);
assert.equal(cpu.cpuPercentOfOneCore, (4000 / 300000) * 100);
assert.equal(
  cleanupCpuWindow({ samples: [cpuStart], seconds: 300, startTick: 100 }),
  null,
);

assert.equal(
  cleanupCpuWindow({
    samples: [cpuStart, { ...cpuEnd, tick: 401 }],
    seconds: 300,
    startTick: 100,
  }),
  null,
);

assert.equal(
  cleanupCpuWindow({
    samples: [cpuStart, { ...cpuEnd, pid: 11 }],
    seconds: 300,
    startTick: 100,
  }),
  null,
);
