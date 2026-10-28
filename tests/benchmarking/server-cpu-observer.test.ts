import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  limitServerCores,
  parseCpuList,
} from '../../benchmarking/server/cores.ts';
import {
  observeServerCpu,
  parseProcessStat,
  processCpuDelta,
  parseFlyCpuSample,
  flyCpuDelta,
  selectFlyCpuWindow,
  parseMachineCpu,
  machineCpuDelta,
} from '../../benchmarking/server/observer.ts';

test(
  'server core limits affect only the target and restore newly created threads',
  { skip: process.platform !== 'linux', timeout: 10000 },
  async () => {
    const affinity = async (path: string) =>
      parseCpuList(
        (await readFile(path, 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)[1],
      );
    const ownBefore = await affinity('/proc/self/status');

    const child = spawn(
      process.execPath,
      [
        '-e',
        'const {Worker}=require("node:worker_threads"); process.stdout.write("ready\\n"); process.stdin.on("data",()=>{new Worker("setInterval(()=>{},1000)",{eval:true});setTimeout(()=>process.stdout.write("thread\\n"),100)});setInterval(()=>{},1000)',
      ],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key !== 'NODE_TEST_CONTEXT',
          ),
        ),
      },
    );

    let limit: Awaited<ReturnType<typeof limitServerCores>>;

    try {
      await once(child.stdout, 'data', { signal: AbortSignal.timeout(3000) });
      const original = await affinity(`/proc/${child.pid}/status`);

      limit = await limitServerCores({ pid: child.pid, count: 1 });
      assert.deepEqual(
        await affinity(`/proc/${child.pid}/status`),
        original.slice(0, 1),
      );
      assert.deepEqual(
        await affinity('/proc/self/status'),
        ownBefore,
        'The load generator keeps its existing affinity',
      );

      const created = once(child.stdout, 'data', {
        signal: AbortSignal.timeout(3000),
      });

      child.stdin.write('new');
      await created;
      const threads = await readdir(`/proc/${child.pid}/task`);

      assert(
        threads.some(
          (tid) => !(tid in limit.metadata.originalThreadAffinities),
        ),
        'Create a thread while the core restriction is active',
      );
      await limit.restore();

      for (const tid of await readdir(`/proc/${child.pid}/task`)) {
        assert.deepEqual(
          await affinity(`/proc/${child.pid}/task/${tid}/status`),
          original,
        );
      }

      await limit.restore();
    } finally {
      await limit?.restore();

      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');

        child.kill('SIGTERM');
        await exited;
      }
    }
  },
);

test('local machine CPU matches Fly busy modes, excludes guest double counting, and honors selected cores', () => {
  const before = parseMachineCpu(
    'cpu0 10 20 30 40 50 60 70 80 999 999\ncpu1 100 200 300 400 500 600 700 800 999 999',
    [1],
  );
  const after = parseMachineCpu(
    'cpu0 20 30 40 50 60 70 80 90 9999 9999\ncpu1 110 210 310 410 510 610 710 810 9999 9999',
    [1],
  );
  const delta = machineCpuDelta({ before, after, elapsedMs: 1000 });

  assert.equal(delta.cpuMs, 500);
  assert.equal(delta.userMs, 200);
  assert.equal(delta.systemMs, 300);
  assert.equal(delta.cpuPercentOfOneCore, 50);
  assert.equal(delta.cpuPercentOfMachine, 50);
  assert.equal(delta.stealMs, 100);
  assert.equal(delta.iowaitMs, 100);
  assert.throws(() => parseMachineCpu('cpu0 1 2', [0]), /Invalid/);
  assert.throws(() => parseMachineCpu('cpu0 1 2 3 4 5 6 7 8', [1]), /Missing/);
  assert.throws(
    () => machineCpuDelta({ before: after, after: before, elapsedMs: 1000 }),
    /reset/,
  );

  assert.throws(
    () =>
      machineCpuDelta({
        before,
        after: [{ ...after[0], id: 2 }],
        elapsedMs: 1000,
      }),
    /identity/,
  );
});

const flySeries = (time: number, value: number, cores = ['0', '1']) =>
  cores.flatMap((cpu_id) =>
    ['user', 'nice', 'system', 'irq', 'softirq', 'steal', 'iowait'].map(
      (mode) => ({
        metric: { cpu_id, mode, instance: 'machine' },
        values: [[time, String(value)]] as [number, string][],
      }),
    ),
  );

test('process CPU parsing handles spaces and parentheses in the process name', () => {
  const fields = Array.from({ length: 30 }, () => '0');

  fields[0] = 'S';
  fields[11] = '123';
  fields[12] = '45';
  fields[19] = '789';

  assert.deepEqual(
    parseProcessStat(`42 (game server (worker)) ${fields.join(' ')}`),
    {
      pid: 42,
      userTicks: 123,
      systemTicks: 45,
      startedTicks: 789,
    },
  );

  assert.throws(() => parseProcessStat('not a stat record'), /Invalid/);
});

test('Fly centisecond counters sum busy modes without counting steal or idle as CPU', () => {
  const series = (time: number, value: number) =>
    ['0', '1'].flatMap((cpu_id) =>
      ['user', 'nice', 'system', 'irq', 'softirq', 'steal', 'iowait'].map(
        (mode) => ({
          metric: { cpu_id, mode, instance: 'machine' },
          values: [[time, String(value)]] as [number, string][],
        }),
      ),
    );

  const before = parseFlyCpuSample(series(100, 1000));
  const after = parseFlyCpuSample(series(160, 1100));
  const result = flyCpuDelta({ before, after });

  assert.equal(result.cpuMs, 10000);
  assert.equal(result.userMs, 4000);
  assert.equal(result.systemMs, 6000);
  assert.equal(result.stealMs, 2000);
  assert.equal(result.cpuPercentOfOneCore, (10000 / 60000) * 100);
  assert.equal(result.cpuPercentOfMachine, result.cpuPercentOfOneCore / 2);
  assert.throws(() => flyCpuDelta({ before, after: before }), /No new/);
  assert.throws(
    () => flyCpuDelta({ before: after, after: { ...before, at: 220 } }),
    /reset/,
  );
  assert.throws(() => parseFlyCpuSample([]), /exactly one/);
  assert.throws(() => parseFlyCpuSample(series(100, 1).slice(1)), /missing/);
});

test('CPU delta reports one-core utilization and rejects restarted processes', () => {
  const before = {
    pid: 42,
    startedTicks: 100,
    userTicks: 300,
    systemTicks: 40,
  };

  const after = { ...before, userTicks: 350, systemTicks: 50 };

  assert.deepEqual(processCpuDelta({ before, after, elapsedMs: 2000 }), {
    elapsedMs: 2000,
    userMs: 500,
    systemMs: 100,
    cpuMs: 600,
    cpuPercentOfOneCore: 30,
  });

  assert.throws(
    () =>
      processCpuDelta({
        before,
        after: { ...after, startedTicks: 101 },
        elapsedMs: 2000,
      }),
    /restarted/,
  );

  assert.throws(
    () =>
      processCpuDelta({
        before,
        after: { ...after, userTicks: 299 },
        elapsedMs: 2000,
      }),
    /backward/,
  );
});

test('Fly CPU samples reject duplicate mode series and changed core identities', () => {
  const input = flySeries(100, 1000);

  assert.throws(() => parseFlyCpuSample([...input, input[0]]), /duplicat/);
  const before = parseFlyCpuSample(input);
  const after = parseFlyCpuSample(flySeries(160, 1100, ['1', '2']));

  assert.throws(() => flyCpuDelta({ before, after }), /changed/);
});

test('one core resetting is rejected even when the aggregate counter rises', () => {
  const before = parseFlyCpuSample(flySeries(100, 1000));
  const input = flySeries(160, 1100);

  input.find(
    (entry) => entry.metric.cpu_id === '0' && entry.metric.mode === 'user',
  ).values[0][1] = '900';
  input.find(
    (entry) => entry.metric.cpu_id === '1' && entry.metric.mode === 'user',
  ).values[0][1] = '1400';
  const after = parseFlyCpuSample(input);

  assert(after.ticks.user > before.ticks.user);
  assert.throws(() => flyCpuDelta({ before, after }), /reset/);
});

test('raw Fly counters and actual sample skew remain reconstructable', () => {
  const beforeInput = flySeries(100, 1000);

  beforeInput[0].values = [
    [99.5, '990'],
    [101, '1001'],
  ];
  const before = parseFlyCpuSample(beforeInput);
  const afterInput = flySeries(160, 1100);

  afterInput[0].values = [
    [159.75, '1090'],
    [161, '1101'],
  ];
  const after = parseFlyCpuSample(afterInput);
  const result = flyCpuDelta({ before, after });

  assert.equal(before.at, 100);
  assert.equal(before.earliestAt, 99.5);
  assert.equal(before.boundaryUncertaintyMs, 500);
  assert.deepEqual(before.raw, beforeInput);
  assert.equal(before.coreTicks['0'].user, 990);
  assert.equal(before.sampleTimes['0'].user, 99.5);
  assert.equal(result.boundaryUncertaintyMs, 750);
  assert.equal(
    result.cpuMs,
    (after.ticks.user -
      before.ticks.user +
      after.ticks.nice -
      before.ticks.nice +
      after.ticks.system -
      before.ticks.system +
      after.ticks.irq -
      before.ticks.irq +
      after.ticks.softirq -
      before.ticks.softirq) *
      10,
  );
  const stale = flySeries(100, 1000);

  stale[0].values = [
    [97, '900'],
    [101, '1001'],
  ];
  assert.throws(() => parseFlyCpuSample(stale), /unsynchronized/);
  const reversed = flySeries(100, 1000);

  reversed[0].values = [
    [101, '1001'],
    [100, '1000'],
  ];
  assert.throws(() => parseFlyCpuSample(reversed), /increase/);
});

test('historical CPU selection uses common scrapes wholly inside active bounds', () => {
  const input = flySeries(145, 1000).map((entry) => ({
    ...entry,
    values: [90, 100, 115, 130, 145].map(
      (time) =>
        [time, String(time === 145 ? 999999 : time * 10)] as [number, string],
    ),
  }));

  const selected = selectFlyCpuWindow(input, { start: 100500, end: 130000 });

  assert(selected);
  assert.equal(selected.before.at, 115);
  assert.equal(selected.after.at, 130);
  assert.equal(flyCpuDelta(selected).elapsedMs, 15000);
  assert.equal(
    selected.after.coreTicks['0'].user,
    1300,
    'A post-window counter spike is excluded',
  );
  assert.equal(selectFlyCpuWindow(input, { start: 115001, end: 130000 }), null);

  const mismatched = input.map((entry, index) => ({
    ...entry,
    values: index
      ? entry.values
      : entry.values.filter(([time]) => time !== 115),
  }));

  assert.equal(
    selectFlyCpuWindow(mismatched, { start: 100500, end: 130000 }),
    null,
    'Each boundary must exist in every core/mode series',
  );
  assert.throws(
    () => selectFlyCpuWindow(input, { start: 130000, end: 100500 }),
    /Invalid/,
  );
});

test('live CPU reads renew credentials after workload preparation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unicorn-fly-observer-'));
  const oldPath = process.env.PATH;
  const originalFetch = globalThis.fetch;
  const headers: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  const series = flySeries(now - 15, 1000).map((entry) => ({
    ...entry,
    values: [...entry.values, [now, '1100'] as [number, string]],
  }));

  try {
    await writeFile(
      join(directory, 'fly'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const file = ${JSON.stringify(join(directory, 'counter'))};
if (process.argv[2] === 'machine') {
  console.log(JSON.stringify([{id:'fixture',state:'started',config:{guest:{cpus:2}}}]));
} else {
  let count=0;try{count=Number(fs.readFileSync(file,'utf8'))}catch{}
  fs.writeFileSync(file,String(++count));
  console.log('Bearer fixture-token-'+count);
}
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${directory}:${oldPath}`;

    globalThis.fetch = async (_input, init) => {
      headers.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ status: 'success', data: { result: series } });
    };

    const observer = await observeServerCpu({
      url: 'https://fixture.invalid',
      flyApp: 'fixture',
      flyOrg: 'fixture',
      flyMachine: 'fixture',
    });

    assert(observer.available);

    const result = await observer.finish({
      start: (now - 20) * 1000,
      end: now * 1000,
    });

    assert(result.available);
    assert.deepEqual(headers, [
      'Bearer fixture-token-1',
      'Bearer fixture-token-2',
    ]);
  } finally {
    process.env.PATH = oldPath;
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
