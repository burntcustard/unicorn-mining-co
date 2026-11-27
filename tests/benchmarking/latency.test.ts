import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  calibrateClock,
  clockMapping,
  latencyDistribution,
  observerAverage,
} from '../../benchmarking/latency/metrics.ts';
import { parseLatencyOptions } from '../../benchmarking/latency/options.ts';
import { installLatencyShutdown } from '../../benchmarking/latency/lifecycle.ts';

test('browser clock calibration retains samples and bounds the lowest round trip', () => {
  const samples = [
    { before: 100, after: 110, page: 2 },
    { before: 115, after: 117, page: 18 },
    { before: 120, after: 128, page: 25 },
  ];
  const result = calibrateClock(samples, 1);

  assert.equal(result.offset, 98);
  assert.equal(result.uncertainty, 2);
  assert.equal(result.samples, samples);
  const after = calibrateClock([{ before: 215, after: 217, page: 117 }]);
  const mapping = clockMapping(result, after);

  assert.equal(mapping.map(18), 116);
  assert.equal(mapping.map(117), 216);
  assert.equal(mapping.drift, 1);
  assert.equal(mapping.uncertainty, 3);
});

test('three remote observations remain one paired trial and misses stay missing', () => {
  assert.equal(observerAverage([10, 20, 30]), 20);
  assert.equal(observerAverage([10, null, 30]), null);
  assert.equal(observerAverage([10, 20]), null);

  assert.deepEqual(latencyDistribution([10, 20, null, 40]), {
    trials: 4,
    observed: 3,
    missed: 1,
    mean: 70 / 3,
    min: 10,
    max: 40,
  });

  assert.deepEqual(latencyDistribution([null, NaN]), {
    trials: 2,
    observed: 0,
    missed: 2,
    mean: null,
    min: null,
    max: null,
  });
});

test('latency CLI defaults to four-client healthy-link production measurement', () => {
  const options = parseLatencyOptions([]);

  assert.equal(options.url, 'http://localhost:3000/');
  assert.equal(options.networkPermission, 'loopback-network');
  assert.equal(options.scenario, 'both');
  assert.equal(options.target, 'local');
  assert.equal(options.trials, 5);
  assert.equal(options.minFps, 50);
  assert.equal(options.maxClockUncertainty, 2);
  assert.equal(options.preparationTimeoutMs, 600000);
  assert.equal(options.trialReadinessMs, 8000);
  const live = parseLatencyOptions([
    '--target',
    'live',
    '--scenario',
    'fire',
    '--trials',
    '7',
  ]);

  assert.equal(live.url, 'https://unicorn-mining.co/');
  assert.equal(live.networkPermission, null);
  assert.equal(live.trials, 7);
  assert.throws(() => parseLatencyOptions(['--scenario', 'overload']));
  assert.throws(() => parseLatencyOptions(['--headless']));
  assert.throws(() => parseLatencyOptions(['--browser', 'firefox']));
  assert.throws(() => parseLatencyOptions(['--min-fps', '1']));
  assert.throws(() => parseLatencyOptions(['--max-clock-uncertainty', '100']));
  assert.throws(() => parseLatencyOptions(['--url', 'file:///tmp/app']));
  assert.throws(() => parseLatencyOptions(['--target', 'staging']));
});

test('both termination signals wait for one cleanup and preserve signal exit status', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const signals = new EventEmitter();
    const interrupted: string[] = [];
    const exits: number[] = [];
    let cleanups = 0;
    let finish: () => void;

    const cleanup = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const shutdown = installLatencyShutdown({
      signals,
      onInterrupt: (received) => interrupted.push(received),
      cleanup: async () => {
        assert.deepEqual(interrupted, [signal]);
        cleanups++;
        await cleanup;
      },
      exit: (code) => exits.push(code),
    });

    signals.emit(signal);
    signals.emit(signal);
    await Promise.resolve();
    assert.equal(shutdown.signal.aborted, true);
    assert.equal(cleanups, 1);
    assert.deepEqual(exits, []);
    finish!();
    await shutdown.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(exits, [signal === 'SIGINT' ? 130 : 143]);
    shutdown.dispose();
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  }
});

test('termination has a final deadline when cleanup never resolves', async () => {
  const signals = new EventEmitter();
  let finish: (code: number) => void;

  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });

  const shutdown = installLatencyShutdown({
    signals,
    onInterrupt: () => {},
    cleanup: () => new Promise(() => {}),
    timeoutMs: 10,
    exit: (code) => finish(code),
  });

  signals.emit('SIGTERM');
  assert.equal(await exited, 143);
  shutdown.dispose();
});

test('normal completion shares cleanup without requesting a signal exit', async () => {
  const signals = new EventEmitter();
  let cleanups = 0;

  const shutdown = installLatencyShutdown({
    signals,
    onInterrupt: () => assert.fail('Normal completion is not interrupted'),
    cleanup: async () => {
      cleanups++;
    },
    exit: () => assert.fail('Normal cleanup must not exit the process'),
  });

  await Promise.all([shutdown.close(), shutdown.close()]);
  assert.equal(cleanups, 1);
  assert.equal(shutdown.signal.aborted, false);
  shutdown.dispose();
});
