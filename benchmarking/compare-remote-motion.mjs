/* global process */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.slice(2).split(/=(.*)/s, 2)),
);

assert(
  options.before && options.after && options.output,
  'Specify --before, --after and --output',
);
const results = { node: process.version, runs: [], comparisons: [] };
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (let repeat = 0; repeat < 3; repeat++) {
  const variants = options.previous
    ? ['before', 'after', 'previous']
    : ['before', 'after'];
  const order = options.previous
    ? [...variants.slice(repeat), ...variants.slice(0, repeat)]
    : repeat % 2
      ? variants.toReversed()
      : variants;

  for (const variant of order) {
    const child = spawnSync(
      process.execPath,
      ['benchmarking/remote-motion.mjs', '--bundle=' + options[variant]],
      { encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
    );

    assert.equal(child.status, 0, child.stderr || String(child.error));
    results.runs.push({ variant, repeat, cases: JSON.parse(child.stdout) });
    writeFileSync(options.output, JSON.stringify(results, null, 2) + '\n');
    console.log(`${variant} client repeat ${repeat + 1}/3 completed`);
  }
}

for (const reference of results.runs[0].cases) {
  const cases = (variant) =>
    results.runs
      .filter((run) => run.variant === variant)
      .map((run) =>
        run.cases.find(
          (c) =>
            c.players === reference.players &&
            c.scenario === reference.scenario,
        ),
      );
  const before = cases('before'),
    after = cases('after');
  const beforeCpuMs = median(
    before.flatMap((c) => c.samples.map((s) => s.cpuMs)),
  );
  const afterCpuMs = median(
    after.flatMap((c) => c.samples.map((s) => s.cpuMs)),
  );
  const cpuChangePercent = (afterCpuMs / beforeCpuMs - 1) * 100;
  const previous = options.previous ? cases('previous') : [];
  const previousCpuMs = previous.length
    ? median(previous.flatMap((c) => c.samples.map((s) => s.cpuMs)))
    : undefined;
  const cpuChangeFromPreviousPercent =
    previousCpuMs === undefined
      ? undefined
      : (afterCpuMs / previousCpuMs - 1) * 100;

  for (const sample of previous) {
    assert.deepEqual(sample.quality, previous[0].quality);
  }

  for (const sample of before) {
    assert.deepEqual(sample.quality, before[0].quality);
  }

  for (const sample of after) {
    assert.deepEqual(sample.quality, after[0].quality);
  }
  const beforeQuality = before[0].quality;
  const afterQuality = after[0].quality;

  assert.equal(afterQuality.backwards, 0);
  // Permit at most one additional 30 Hz tick, including floating-point error.
  assert(afterQuality.meanLagMs <= beforeQuality.meanLagMs + 1000 / 30 + 1e-6);
  assert(afterQuality.maxLagMs <= beforeQuality.maxLagMs + 1000 / 30 + 1e-6);
  assert(afterQuality.stalls <= beforeQuality.stalls);

  if (['jitter', 'burst'].includes(reference.scenario)) {
    assert(afterQuality.meanSpeedChange < beforeQuality.meanSpeedChange);
  }
  results.comparisons.push({
    players: reference.players,
    scenario: reference.scenario,
    beforeCpuMs,
    afterCpuMs,
    previousCpuMs,
    cpuChangeFromPreviousPercent,
    previousQuality: previous[0]?.quality,
    cpuChangePercent,
    beforeQuality: before[0].quality,
    afterQuality: after[0].quality,
    passed: cpuChangePercent <= 10 && (cpuChangeFromPreviousPercent ?? 0) <= 10,
  });
}
writeFileSync(options.output, JSON.stringify(results, null, 2) + '\n');
console.log(
  JSON.stringify(
    results.comparisons.map(
      ({
        players,
        scenario,
        cpuChangePercent,
        cpuChangeFromPreviousPercent,
        passed,
      }) => ({
        players,
        scenario,
        cpuChangePercent,
        cpuChangeFromPreviousPercent,
        passed,
      }),
    ),
    null,
    2,
  ),
);
assert(
  results.comparisons.every((c) => c.passed),
  'Client CPU regression exceeded 10%',
);
