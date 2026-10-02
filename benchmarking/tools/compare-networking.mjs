/* global process */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.slice(2).split('=')),
);

if (!options.before || !options.after || !options.output) {
  throw new Error(
    'Specify --before, --after saved production bundles and --output JSON',
  );
}
const repeats = Number(options.repeats || 3);
const ticks = Number(options.ticks || 1800);

assert(Number.isInteger(repeats) && repeats >= 3);
assert(Number.isInteger(ticks) && ticks > 0);
const populations = (options.players || '4,8,16').split(',').map(Number);

assert(
  populations.every(
    (players) => Number.isInteger(players) && players >= 1 && players <= 40,
  ),
);
const routes = (options.scenarios || 'convoy,spread,contact,modules').split(
  ',',
);

assert(
  routes.every((route) =>
    ['convoy', 'spread', 'contact', 'modules'].includes(route),
  ),
);
const scenarios = populations.flatMap((players) =>
  routes.map((scenario) => ({ players, scenario })),
);
const results = {
  node: process.version,
  repeats,
  ticks,
  runs: [],
  comparisons: [],
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);

  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
};

for (const { players, scenario } of scenarios) {
  const samples = { before: [], after: [] };

  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const variant of repeat % 2
      ? ['after', 'before']
      : ['before', 'after']) {
      const child = spawnSync(
        process.execPath,
        [
          'benchmarking/tools/production-flight.mjs',
          '--bundle=' + options[variant],
          '--players=' + players,
          '--scenario=' + scenario,
          '--ticks=' + ticks,
          '--warm',
          '--semi-space=16',
        ],
        { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
      );

      assert.equal(child.status, 0, child.stderr || String(child.error));
      const run = JSON.parse(child.stdout);

      samples[variant].push(run);
      results.runs.push({ variant, repeat, ...run });
      writeFileSync(options.output, JSON.stringify(results, null, 2) + '\n');
    }
  }
  const reference = samples.before[0];

  for (const run of [...samples.before, ...samples.after]) {
    for (const key of [
      'hash',
      'bytes',
      'packets',
      'positions',
      'entities',
      'maxEntities',
    ]) {
      assert.deepEqual(
        run[key],
        reference[key],
        `${players} ${scenario}: ${key}`,
      );
    }
  }
  const before = median(samples.before.map((run) => run.cpuMs));
  const after = median(samples.after.map((run) => run.cpuMs));
  const cpuChangePercent = (after / before - 1) * 100;
  const comparison = {
    players,
    scenario,
    beforeCpuMs: before,
    afterCpuMs: after,
    cpuChangePercent,
    passed: cpuChangePercent <= 10,
  };

  results.comparisons.push(comparison);
  writeFileSync(options.output, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(comparison));
}
assert(
  results.comparisons.every(({ passed }) => passed),
  'CPU regression exceeded 10%; inspect the saved results',
);
