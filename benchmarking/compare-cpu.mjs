/* global process */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const options = Object.fromEntries(
  args
    .filter((arg) => !arg.startsWith('--variant='))
    .map((arg) => arg.slice(2).split(/=(.*)/s, 2)),
);
const variants = [
  { name: 'baseline', bundle: options.baseline },
  ...args
    .filter((arg) => arg.startsWith('--variant='))
    .map((arg) => {
      const value = arg.slice('--variant='.length);
      const separator = value.indexOf(':');

      assert(separator > 0, 'Use --variant=name:/path/to/bundle.mjs');
      return {
        name: value.slice(0, separator),
        bundle: value.slice(separator + 1),
      };
    }),
];

assert(options.baseline && options.output && variants.length >= 2);
assert.equal(new Set(variants.map(({ name }) => name)).size, variants.length);
const repeats = Number(options.repeats || 5);
const ticks = Number(options.ticks || 1800);
const players = (options.players || '4,8,16').split(',').map(Number);
const scenarios = (options.scenarios || 'convoy,spread,contact,modules').split(
  ',',
);
const allowMangledWireKeys = args.includes('--allow-mangled-wire-keys');

assert(Number.isInteger(repeats) && repeats >= variants.length);
assert(Number.isInteger(ticks) && ticks > 0);
assert(
  players.every(
    (count) => Number.isInteger(count) && count >= 1 && count <= 40,
  ),
);
assert(
  scenarios.every((name) =>
    ['convoy', 'spread', 'contact', 'modules'].includes(name),
  ),
);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const results = {
  node: process.version,
  variants,
  repeats,
  ticks,
  players,
  scenarios,
  wireHashCompared: !allowMangledWireKeys,
  runs: [],
  comparisons: [],
  aggregates: [],
};
const save = () =>
  writeFileSync(options.output, JSON.stringify(results, null, 2) + '\n');

for (const count of players) {
  for (const scenario of scenarios) {
    const samples = new Map(variants.map(({ name }) => [name, []]));

    for (let repeat = 0; repeat < repeats; repeat++) {
      const ordered = variants
        .slice(repeat % variants.length)
        .concat(variants.slice(0, repeat % variants.length));

      for (const variant of ordered) {
        const child = spawnSync(
          process.execPath,
          [
            'benchmarking/production-flight.mjs',
            '--bundle=' + variant.bundle,
            '--players=' + count,
            '--scenario=' + scenario,
            '--ticks=' + ticks,
            '--warm',
            '--semi-space=16',
          ],
          { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
        );

        assert.equal(child.status, 0, child.stderr || String(child.error));
        const run = JSON.parse(child.stdout);

        samples.get(variant.name).push(run);
        results.runs.push({ variant: variant.name, repeat, ...run });
        save();
      }
      console.log(`${count} ${scenario}: repeat ${repeat + 1}/${repeats}`);
    }
    const reference = samples.get('baseline')[0];

    for (const run of results.runs.filter(
      (run) => run.players === count && run.scenario === scenario,
    )) {
      for (const key of [
        'hash',
        'bytes',
        'packets',
        'positions',
        'entities',
        'maxEntities',
      ]) {
        if (key === 'hash' && allowMangledWireKeys) continue;
        assert.deepEqual(
          run[key],
          reference[key],
          `${count} ${scenario}: ${key}`,
        );
      }
    }
    const before = samples.get('baseline');
    const baselineCpuMs = median(before.map((run) => run.cpuMs));

    for (const variant of variants.slice(1)) {
      const after = samples.get(variant.name);
      const cpuMs = median(after.map((run) => run.cpuMs));
      const paired = after.map(
        (run, index) => 100 * (1 - run.cpuMs / before[index].cpuMs),
      );
      const comparison = {
        players: count,
        scenario,
        variant: variant.name,
        baselineCpuMs,
        cpuMs,
        reductionPercent: 100 * (1 - cpuMs / baselineCpuMs),
        pairedMedianPercent: median(paired),
        pairedMinPercent: Math.min(...paired),
        pairedMaxPercent: Math.max(...paired),
      };

      results.comparisons.push(comparison);
      console.log(JSON.stringify(comparison));
    }
    save();
  }
}

for (const count of players) {
  for (const variant of variants.slice(1)) {
    const comparisons = results.comparisons.filter(
      (item) => item.players === count && item.variant === variant.name,
    );
    const before = comparisons.reduce(
      (sum, item) => sum + item.baselineCpuMs,
      0,
    );
    const after = comparisons.reduce((sum, item) => sum + item.cpuMs, 0);
    const paired = Array.from({ length: repeats }, (_, repeat) => {
      const cpuFor = (name, scenario) => {
        const run = results.runs.find(
          (item) =>
            item.players === count &&
            item.scenario === scenario &&
            item.variant === name &&
            item.repeat === repeat,
        );

        assert(run, `Missing ${name} ${count} ${scenario} repeat ${repeat}`);
        return run.cpuMs;
      };
      const baselineTotal = scenarios.reduce(
        (sum, scenario) => sum + cpuFor('baseline', scenario),
        0,
      );
      const variantTotal = scenarios.reduce(
        (sum, scenario) => sum + cpuFor(variant.name, scenario),
        0,
      );

      return 100 * (1 - variantTotal / baselineTotal);
    });

    results.aggregates.push({
      players: count,
      variant: variant.name,
      baselineCpuMs: before,
      cpuMs: after,
      reductionPercent: 100 * (1 - after / before),
      pairedMedianPercent: median(paired),
      pairedMinPercent: Math.min(...paired),
      pairedMaxPercent: Math.max(...paired),
    });
  }
}
save();
console.log(JSON.stringify({ aggregates: results.aggregates }));
