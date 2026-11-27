import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrateRefreshRate,
  summarizeFrameIntervals,
} from '../../benchmarking/rendering/frame-metrics.ts';
import { createNetworkObservations } from '../../benchmarking/rendering/network-observations.ts';
import { parseRenderingOptions } from '../../benchmarking/rendering/options.ts';

for (const rate of [60, 119.9, 120, 240, 480]) {
  const regular = Array.from({ length: 240 }, () => 1000 / rate);
  const calibrated = calibrateRefreshRate({ intervals: regular });

  assert(Math.abs(calibrated.refreshRate - rate) < 0.001);
  assert.equal(
    summarizeFrameIntervals({ intervals: regular, refreshRate: rate }).missed,
    0,
  );

  const dropped = [...regular];

  dropped[30] *= 2;
  dropped[100] *= 3;
  assert.equal(
    summarizeFrameIntervals({ intervals: dropped, refreshRate: rate }).missed,
    3,
  );
  assert.equal(
    summarizeFrameIntervals({ intervals: dropped, refreshRate: rate })
      .lateFrames,
    2,
  );
  assert(
    Math.abs(calibrateRefreshRate({ intervals: dropped }).refreshRate - rate) <
      0.001,
  );
}

// Firefox can quantize timestamps; averaging short blocks still recovers 120 Hz.
const timestamps = Array.from(
  { length: 241 },
  (_, index) => Math.round((index * 1000) / 120 / 2) * 2,
);
const quantized = timestamps
  .slice(1)
  .map((value, index) => value - timestamps[index]);

assert(
  Math.abs(calibrateRefreshRate({ intervals: quantized }).refreshRate - 120) <
    1,
);

assert.throws(
  () => summarizeFrameIntervals({ intervals: [0], refreshRate: 60 }),
  /positive/,
);
assert.throws(() => calibrateRefreshRate({ intervals: [] }), /at least 48/);

test('an empty network capture reports zero bytes and empty distributions', () => {
  const report = createNetworkObservations(100).summary(112);

  for (const metric of [
    'websocket-payload-bytes',
    'websocket-message-gap-ms',
    'reconcile-ms',
    'local-same-tick-position-error-m',
  ]) {
    assert.deepEqual(
      report[metric],
      { samples: 0, p95: null, max: null },
      metric,
    );
  }

  assert.equal(report['websocket-total-payload-bytes'], 0);
  assert.deepEqual(report['full-replay-samples'], []);
});

test('network observations report payload bytes, message gaps, and capture offsets', () => {
  const observations = createNetworkObservations(100);

  observations.recordMessage({ data: 'é🚀', startedAt: 102 });
  observations.recordMessage({ data: new ArrayBuffer(9), startedAt: 122 });

  observations.recordMessage({
    data: new Uint16Array(new ArrayBuffer(24), 4, 2),
    startedAt: 128,
  });

  observations.recordMessage({ data: new Blob(['hello']), startedAt: 142 });

  observations.recordReplay({
    startedAt: 125,
    duration: 3.5,
    fromTick: 40,
    targetTick: 47,
  });

  const report = observations.summary(112);

  assert.deepEqual(report['websocket-payload-bytes'], {
    samples: 4,
    p95: 9,
    max: 9,
  });

  assert.equal(report['websocket-total-payload-bytes'], 24);

  assert.deepEqual(report['websocket-message-gap-ms'], {
    samples: 3,
    p95: 20,
    max: 20,
  });

  assert.equal(report['first-raf-capture-offset-ms'], 12);
  assert.deepEqual(report['full-replay-columns'], [
    'capture-time-ms',
    'duration-ms',
    'from-tick',
    'target-tick',
  ]);
  assert.deepEqual(report['full-replay-samples'], [[25, 3.5, 40, 47]]);
});

const defaults = parseRenderingOptions({ args: [] });

assert.equal(defaults.browser, 'chrome');
assert.equal(defaults.cpuThrottle, 1);
assert.deepEqual(defaults.scenarios, [
  'live',
  'large',
  'combat',
  'flight',
  'pirate',
]);

assert.deepEqual(
  parseRenderingOptions({
    args: ['--browser', 'firefox', '--scenario', 'pirate'],
  }).scenarios,
  ['pirate'],
);

assert.deepEqual(
  parseRenderingOptions({
    args: ['--scenario', 'pirate,live'],
  }).scenarios,
  ['pirate', 'live'],
);

assert.throws(
  () => parseRenderingOptions({ args: ['firefox', '15', '/tmp/result.json'] }),
  /Unexpected argument/,
);
assert.throws(
  () => parseRenderingOptions({ args: ['--scenario', 'pretend-pirate'] }),
  /Choose scenarios/,
);
assert.throws(
  () => parseRenderingOptions({ args: ['--refresh-rate', 'NaN'] }),
  /Unknown option/,
);

for (const option of [
  '--resolution',
  '--native',
  '--emulated',
  '--duration',
  '--scenarios',
]) {
  assert.throws(
    () => parseRenderingOptions({ args: [option] }),
    /Unknown option/,
  );
}

assert.throws(
  () => parseRenderingOptions({ args: ['--scenario', 'reference'] }),
  /Choose scenarios/,
);
assert.equal(
  parseRenderingOptions({ args: ['--seconds', '600'] }).seconds,
  600,
);

assert.equal(
  parseRenderingOptions({ args: ['--cpu-throttle', '4'] }).cpuThrottle,
  4,
);

for (const rate of ['0', '-1', 'NaN', 'Infinity']) {
  assert.throws(
    () => parseRenderingOptions({ args: [`--cpu-throttle=${rate}`] }),
    /CPU throttle/,
  );
}

assert.throws(
  () =>
    parseRenderingOptions({
      args: ['--browser', 'firefox', '--cpu-throttle', '4'],
    }),
  /requires Chrome/,
);
