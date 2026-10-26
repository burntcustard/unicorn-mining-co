import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResponseFrame } from '../../benchmarking/latency/input-response-metrics.ts';
import {
  calibrateClock,
  clockMapping,
  latencyDistribution,
  observerAverage,
  responseForTrial,
} from '../../benchmarking/latency/metrics.ts';
import { parseLatencyOptions } from '../../benchmarking/latency/options.ts';
import {
  exposeLatencyBindings,
  latencyLiterals,
} from '../../benchmarking/latency/assets.ts';
import { parseAst } from 'rolldown/parseAst';
import { latencyNetworkPermission } from '../../benchmarking/latency/permissions.ts';
import { autogun } from '../../src/specs/modules/offense/autogun.ts';
import { autogunAmmo } from '../../src/specs/items/autogun-ammo.ts';
import { stationSpecs } from '../../src/specs/stations/index.ts';
import { installLatencyShutdown } from '../../benchmarking/latency/lifecycle.ts';
import { loadProtocolRuntime } from '../../benchmarking/utilities/protocol-runtime.ts';
import { encodeClientMessage } from '../../src/client/protocol/binary-control.ts';
import type { ClientMessage } from '../../src/client/protocol/network.ts';

test('browser clock calibration retains samples and bounds the lowest round trip', () => {
  const samples = [
    { before: 100, after: 110, page: 2 },
    { before: 115, after: 117, page: 18 },
    { before: 120, after: 128, page: 25 },
  ];
  const result = calibrateClock(samples);

  assert.equal(result.offset, 98);
  assert.equal(result.uncertainty, 1);
  assert.equal(result.samples, samples);
  const after = calibrateClock([{ before: 215, after: 217, page: 117 }]);
  const mapping = clockMapping(result, after);

  assert.equal(mapping.map(18), 116);
  assert.equal(mapping.map(117), 216);
  assert.equal(mapping.drift, 1);
  assert.equal(mapping.uncertainty, 2);
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

test('production binding exposure preserves imports, exports, and deferred imports', () => {
  const original =
    'import {foo as a} from "./first.js"; const {b,c:d}={b:1,c:2}; class E {} function f() {} const later=()=>import("./later.js"); export{a,b,d,E,f,later};';
  const exposed = exposeLatencyBindings(original);

  assert(exposed.startsWith(original));
  assert(exposed.endsWith('__latencyRefs.push(b,d,E,f,later);\n'));
  const before = parseAst(original).body;
  const after = parseAst(exposed).body;

  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(exposed.match(/import\(/g)?.length, 1);
});

test('latency CLI defaults to four-client healthy-link production measurement', () => {
  const options = parseLatencyOptions([]);

  assert.equal(options.url, 'http://localhost:3000/');
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
  assert.equal(live.trials, 7);
  assert.throws(() => parseLatencyOptions(['--scenario', 'overload']));
  assert.throws(() => parseLatencyOptions(['--headless']));
  assert.throws(() => parseLatencyOptions(['--browser', 'firefox']));
  assert.throws(() => parseLatencyOptions(['--min-fps', '1']));
  assert.throws(() => parseLatencyOptions(['--max-clock-uncertainty', '100']));
  assert.throws(() => parseLatencyOptions(['--url', 'file:///tmp/app']));
  assert.throws(() => parseLatencyOptions(['--target', 'staging']));
});

test('steering endpoints require completed stationary frames and actual onset', () => {
  const frames: ResponseFrame[] = [0, 10, 20, 35, 45].map((completedAt) => ({
    completedAt,
    rotation: completedAt < 40 ? 0 : -0.01,
    spin: 0,
    projectileDraws: [] as ResponseFrame['projectileDraws'],
  }));

  const response = responseForTrial({
    frames,
    edgeAt: 25,
    endAt: 50,
    trial: { id: 1, kind: 'steer', direction: -1 },
    previousIds: [],
  });

  assert.equal(response.steering?.ms, 20);
});

test('network permission applies only to the selected local game endpoint', () => {
  assert.equal(
    latencyNetworkPermission('http://localhost:3000/'),
    'loopback-network',
  );
  assert.equal(
    latencyNetworkPermission('http://127.0.0.1:3000/'),
    'loopback-network',
  );
  assert.equal(
    latencyNetworkPermission('http://[::1]:3000/'),
    'loopback-network',
  );
  assert.equal(
    latencyNetworkPermission('http://192.168.1.2:3000/'),
    'local-network',
  );
  assert.equal(latencyNetworkPermission('https://game.example.com/'), null);
  assert.equal(latencyNetworkPermission('https://127.example.com/'), null);
  assert.equal(latencyNetworkPermission('https://192.168.example.com/'), null);
});

test('production preparation literals include property rewrites as well as protocol tags', () => {
  assert.equal(latencyLiterals.remove, '_remove');
  assert.notEqual(latencyLiterals.buyAmmo, 'buyAmmo');
  assert.notEqual(latencyLiterals.hornDrill, 'hornDrill');
});

test('browser timer granularity is included in cross-client clock bounds', () => {
  const calibration = calibrateClock(
    [{ before: 100, after: 102, page: 10 }],
    1,
  );

  assert.equal(calibration.timerResolution, 1);
  assert.equal(calibration.uncertainty, 2);
  assert.equal(clockMapping(calibration, calibration).uncertainty, 2);
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

test('shared protocol runtime emits a usable codec and the ordinary catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unicorn protocol-runtime-'));

  try {
    const { runtime } = await loadProtocolRuntime(directory);

    assert.equal(runtime.catalog.ammoRounds, autogunAmmo.rounds);
    assert.equal(runtime.catalog.ammoResource, autogunAmmo.resource);
    assert(
      runtime.catalog.ships.mustang.mounts.some((fits) =>
        fits.includes('autogun'),
      ),
    );
    assert.equal(
      runtime.catalog.modules.autogun.fireInterval,
      autogun.fireInterval,
    );
    assert.equal(
      runtime.catalog.modules.autogun.activationDuration,
      autogun.activationDuration,
    );

    for (const [ship, mount, x] of [
      ['mustang', 4, 46],
      ['arrow', 6, 56],
      ['crotus', 0, 56],
    ] as const) {
      const definition = runtime.catalog.ships[ship];

      assert.equal(
        definition.drillTipsByMount.length,
        definition.mounts.length,
      );
      assert.deepEqual(
        definition.drillTipsByMount,
        definition.mounts.map((_, index) =>
          index === mount ? { position: { x, y: 0 }, radius: 3 } : null,
        ),
      );
    }

    assert.deepEqual(runtime.catalog.ships.arrow.mounts[6], [
      'hornDrill',
      'autogun',
      'laser',
    ]);

    for (const [id, specification] of Object.entries(stationSpecs)) {
      assert.equal(
        runtime.catalog.stations[id].localMovementRadius,
        specification.localMovementRadius,
      );
      assert.deepEqual(
        runtime.catalog.stations[id].dockingBays,
        specification.dockingBays,
      );
    }

    const messages: ClientMessage[] = [
      { type: 'hello', playerToken: null },
      { type: 'snapshotAck', sequence: 257 },
    ];

    for (const message of messages) {
      assert.deepEqual(
        runtime.encodeClientMessage(message),
        encodeClientMessage(message),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
