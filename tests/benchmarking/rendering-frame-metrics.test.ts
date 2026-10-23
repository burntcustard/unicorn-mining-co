import assert from 'node:assert/strict';
import {
  calibrateRefreshRate,
  summarizeFrameIntervals,
} from '../../benchmarking/rendering/frame-metrics.ts';
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

const defaults = parseRenderingOptions({ args: [] });

assert.equal(defaults.browser, 'chrome');
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
