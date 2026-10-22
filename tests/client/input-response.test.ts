import assert from 'node:assert/strict';
import {
  firstMotionResponse,
  muzzleOnset,
  projectileOnset,
  steeringOnset,
  type ResponseFrame,
} from '../../benchmarking/tools/input-response-metrics.ts';
import { summarizeSnapshotTraffic } from '../../benchmarking/tools/snapshot-traffic-metrics.ts';

// An input can arrive after the rAF timestamp but before that frame is drawn.
// A later CDP acknowledgement must not define the input time or the baseline.
assert.equal(
  firstMotionResponse({
    edgeAt: 20,
    frames: [
      { completedAt: 18, rotation: 0 },
      { completedAt: 24, rotation: 0.01 },
      { completedAt: 40, rotation: 0.02 },
    ],
  }),
  4,
);

// Angles crossing the branch cut still represent continuous motion.
assert.equal(
  firstMotionResponse({
    edgeAt: 20,
    frames: [
      { completedAt: 18, rotation: Math.PI },
      { completedAt: 24, rotation: -Math.PI },
      { completedAt: 40, rotation: -Math.PI + 0.01 },
    ],
  }),
  20,
);

assert.throws(
  () => firstMotionResponse({ frames: [], edgeAt: 20 }),
  /Missing pre-input frame/,
);

assert.throws(
  () =>
    firstMotionResponse({
      frames: [{ completedAt: 18, rotation: 0 }],
      edgeAt: 20,
    }),
  /Missing motion response/,
);

const frame = (
  completedAt: number,
  rotation: number,
  spin = 0,
  projectileDraws: ResponseFrame['projectileDraws'] = [],
): ResponseFrame => ({ completedAt, rotation, spin, projectileDraws });

const stationary = [frame(2, 0), frame(10, 0), frame(18, 0)];

assert.deepEqual(
  steeringOnset({
    frames: [...stationary, frame(24, -0.01), frame(40, -0.02)],
    edgeAt: 20,
    endAt: 100,
    direction: -1,
  }),
  { ms: 4, reason: null },
  'each neutral steering edge measures its first completed response',
);

assert.deepEqual(
  steeringOnset({
    frames: [
      frame(2, 0, 1),
      frame(10, 0.01, 1),
      frame(18, 0.02, 1),
      frame(24, 0.03),
    ],
    edgeAt: 20,
    endAt: 100,
    direction: 1,
  }),
  { ms: null, reason: 'nonstationary-or-missing-baseline' },
  'continued motion cannot masquerade as an instantaneous input response',
);

assert.deepEqual(
  steeringOnset({
    frames: [
      frame(2, Math.PI),
      frame(10, Math.PI),
      frame(18, Math.PI),
      frame(24, -Math.PI),
      frame(40, -Math.PI + 0.01),
    ],
    edgeAt: 20,
    endAt: 100,
    direction: 1,
  }),
  { ms: 20, reason: null },
  'stationary steering baselines handle wrapped rotations',
);

assert.deepEqual(
  steeringOnset({
    frames: [...stationary, frame(24, 0), frame(40, 0.01)],
    edgeAt: 20,
    endAt: 32,
    direction: 1,
  }),
  { ms: null, reason: 'no-steering-draw' },
  'a later trial cannot supply a missing response',
);

assert.deepEqual(
  projectileOnset({
    frames: [
      frame(18, 0),
      frame(24, 0, 0, [{ id: 7, at: 22 }]),
      frame(40, 0, 0, [{ id: 8, at: 37 }]),
    ],
    edgeAt: 20,
    endAt: 100,
    previousIds: [7],
  }),
  { ms: 20, reason: null },
  'only a newly rendered round completes a ready firing trial',
);

assert.deepEqual(
  projectileOnset({
    frames: [
      frame(24, 0, 0, [{ id: 8, at: 19 }]),
      frame(40, 0, 0, [{ id: 9, at: 37 }]),
    ],
    edgeAt: 20,
    endAt: 100,
    previousIds: [],
  }),
  { ms: 20, reason: null },
  'a pre-input draw completed later is not caused by the key edge',
);

assert.deepEqual(
  projectileOnset({
    frames: [frame(18, 0), frame(24, 0)],
    edgeAt: 20,
    endAt: 100,
    previousIds: [],
  }),
  { ms: null, reason: 'no-projectile-draw' },
  'missing visible shots are reported without substituting predicted entities',
);

assert.deepEqual(
  projectileOnset({
    frames: [frame(24, 0, 0, [{ id: 7, at: 22 }])],
    edgeAt: 20,
    endAt: 100,
    previousIds: [7],
    births: [{ id: 7, at: 21 }],
  }),
  { ms: 4, reason: null },
  'a new shot may reuse a previous speculative ID without losing its response',
);

assert.deepEqual(
  projectileOnset({
    frames: [frame(24, 0, 0, [{ id: 7, at: 22 }])],
    edgeAt: 20,
    endAt: 100,
    previousIds: [],
    births: [{ id: 7, at: 19 }],
  }),
  { ms: null, reason: 'no-projectile-draw' },
  'an earlier shot cannot respond to the next fire edge',
);

assert.deepEqual(
  muzzleOnset({
    frames: [
      {
        ...frame(24, 0),
        muzzleDraws: [{ at: 22, trialId: 1, inView: false, alpha: 1 }],
      },
      {
        ...frame(32, 0),
        muzzleDraws: [{ at: 30, trialId: 1, inView: true, alpha: 0 }],
      },
      {
        ...frame(40, 0),
        muzzleDraws: [{ at: 38, trialId: 1, inView: true, alpha: 1 }],
      },
    ],
    edgeAt: 20,
    endAt: 100,
    trialId: 1,
  }),
  { ms: 20, reason: null },
  'only a visible nontransparent muzzle draw counts as feedback',
);

assert.deepEqual(
  muzzleOnset({
    frames: [
      {
        ...frame(24, 0),
        muzzleDraws: [
          { at: 22, createdAt: 19, trialId: 1 },
          { at: 22, createdAt: 21, trialId: 2 },
        ],
      },
    ],
    edgeAt: 20,
    endAt: 100,
    trialId: 1,
  }),
  { ms: null, reason: 'no-muzzle-draw' },
  'old effects and another trial cannot supply a missing flash',
);

const traffic = summarizeSnapshotTraffic({
  start: 100,
  end: 300,
  messages: [
    { at: 80, type: 'snapshot', acknowledgedSequence: 1 },
    { at: 90, type: 'input', sequence: 1 },
    { at: 100, type: 'input', sequence: 2 },
    { at: 110, type: 'profile', acknowledgedSequence: 99 },
    { at: 120, type: 'input', sequence: 3 },
    {
      at: 130,
      type: 'snapshot',
      snapshotSequence: 8,
      acknowledgedSequence: 3,
    },
    { at: 131, type: 'snapshotAck', sequence: 8 },
    { at: 133, type: 'snapshotAck', sequence: 8 },
    { at: 180, type: 'snapshot', acknowledgedSequence: 3 },
    { at: 200, type: 'input', sequence: 4 },
    { at: 250, type: 'input', sequence: 5 },
    { at: 300, type: 'input', sequence: 6 },
    {
      at: 350,
      type: 'snapshot',
      snapshotSequence: 9,
      acknowledgedSequence: 4,
    },
    { at: 351, type: 'snapshotAck', sequence: 9 },
  ],
});

assert.equal(traffic.inputs, 4, 'only sends inside the half-open window count');
assert.equal(traffic.acknowledgedInputs, 3);
assert.equal(traffic.missingInputAcknowledgments, 1);
assert.equal(traffic.inputsPendingAtEnd, 2);
assert.deepEqual(
  traffic.inputAcknowledgmentMs,
  { count: 3, p50: 30, p95: 150, p99: 150, max: 150 },
  'cumulative acknowledgments cover every earlier input, including a retained late completion',
);
assert.equal(traffic.snapshots, 2);
assert.equal(traffic.snapshotsPerSecond, 10);
assert.equal(traffic.requestedSnapshots, 1);
assert.equal(
  traffic.receipts,
  2,
  'duplicate receipts are still actual application sends',
);
assert.equal(traffic.receiptsPerSecond, 10);

assert.deepEqual(traffic.receiptGapMs, {
  count: 1,
  p50: 2,
  p95: 2,
  p99: 2,
  max: 2,
});

assert.deepEqual(
  traffic.snapshotGapMs,
  { count: 2, p50: 50, p95: 50, p99: 50, max: 50 },
  'the first received gap retains the previous snapshot outside the window',
);
assert.equal(traffic.longestSnapshotGapMs, 50);
assert.equal(traffic.longestSnapshotSilenceMs, 120);
assert.equal(traffic.snapshotSilenceAtEndMs, 120);

const quiet = summarizeSnapshotTraffic({
  start: 100,
  end: 300,
  messages: [
    { at: 80, type: 'snapshot' },
    { at: 200, type: 'input', sequence: 1 },
    { at: 350, type: 'snapshot' },
  ],
});

assert.equal(quiet.snapshots, 0);
assert.equal(quiet.longestSnapshotGapMs, null);
assert.equal(quiet.longestSnapshotSilenceMs, 200);
assert.equal(quiet.snapshotSilenceAtEndMs, 220);
assert.equal(quiet.receiptsPerSecond, 0);
assert.equal(quiet.missingInputAcknowledgments, 1);
assert.equal(quiet.inputsPendingAtEnd, 1);

assert.deepEqual(quiet.inputAcknowledgmentMs, {
  count: 0,
  p50: null,
  p95: null,
  p99: null,
  max: null,
});

const empty = summarizeSnapshotTraffic({ start: 10, end: 110, messages: [] });

assert.equal(empty.snapshotsPerSecond, 0);
assert.equal(empty.receiptsPerSecond, 0);
assert.equal(empty.inputAcknowledgmentMs.count, 0);
assert.equal(empty.missingInputAcknowledgments, 0);
assert.equal(empty.snapshotSilenceAtEndMs, 100);
assert.equal(empty.longestSnapshotSilenceMs, 100);

console.log(
  'Input latency uses DOM edges, neutral baselines, completed draws, and explicit acknowledgment traffic',
);
