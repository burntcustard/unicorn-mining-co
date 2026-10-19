import assert from 'node:assert/strict';
import { firstMotionResponse } from '../../benchmarking/tools/input-response-metrics.ts';

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

console.log('Input latency uses DOM event time and completed frames');
