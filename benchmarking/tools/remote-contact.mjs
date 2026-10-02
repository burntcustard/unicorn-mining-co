import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const [revision, output] = process.argv.slice(2);

assert(
  revision && output,
  'Usage: node benchmarking/tools/remote-contact.mjs BASELINE_REVISION OUTPUT.json.gz',
);
const sourceFiles = ['src/client/network.ts', 'src/client/remote-motion.ts'];
const baselineRevision = execFileSync('git', ['rev-parse', revision], {
  encoding: 'utf8',
}).trim();
const baselineSources = Object.fromEntries(
  sourceFiles.map((path) => [
    path,
    execFileSync('git', ['show', `${baselineRevision}:${path}`], {
      encoding: 'utf8',
    }),
  ]),
);
const hashes = Object.fromEntries(
  ['before', 'after'].map((variant) => [
    variant,
    Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        createHash('sha256')
          .update(
            variant === 'before' ? baselineSources[path] : readFileSync(path),
          )
          .digest('hex'),
      ]),
    ),
  ]),
);
const repetitions = 3;
const runs = [];
const entries = {};

try {
  for (const variant of ['before', 'after']) {
    const entry = `bin/remote-contact-${variant}-${process.pid}.mjs`;

    entries[variant] = entry;
    const bundle = await rolldown({
      input: 'tests/remote-contact.test.ts',
      platform: 'node',
      external: ['ws', /^node:/],
      plugins: [
        {
          name: 'remote-contact-variant',
          transform(code, id) {
            if (variant === 'before') {
              for (const path of sourceFiles) {
                if (id.endsWith('/' + path)) return baselineSources[path];
              }

              // The baseline is expected to fail the new continuity gates.
              // Keep collision and transport checks active in both variants.
              if (id.endsWith('/tests/remote-contact.test.ts')) {
                return code
                  .replace('maxReceiveJump < 1e-7', 'true')
                  .replace('maxSnapshotJump < 1e-7', 'true');
              }
            }
          },
        },
      ],
    });

    await bundle.write({ file: entry, format: 'esm', codeSplitting: false });
    await bundle.close();
  }

  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const variant of repetition % 2
      ? ['after', 'before']
      : ['before', 'after']) {
      const result = execFileSync(process.execPath, [entries[variant]], {
        encoding: 'utf8',
      });
      const cases = result
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      assert.equal(cases.length, 10);
      runs.push({ variant, repetition, cases });
    }
  }

  for (const run of runs) {
    for (const sample of run.cases) {
      const before = runs[0].cases.find(
        (value) =>
          value.separation === sample.separation &&
          value.latency === sample.latency,
      );

      for (const field of [
        'collisionTicks',
        'finalPosition',
        'finalVelocity',
      ]) {
        assert.deepEqual(sample[field], before[field]);
      }

      if (run.variant === 'after') {
        assert(sample.maxReceiveJump < 1e-7);
        assert(sample.maxSnapshotJump < 1e-7);
      }
    }
  }
  const summary = Object.fromEntries(
    ['before', 'after'].map((variant) => [
      variant,
      Object.fromEntries(
        ['maxReceiveJump', 'maxSnapshotJump', 'maxUpdateJump'].map((field) => [
          field,
          Math.max(
            ...runs
              .filter((run) => run.variant === variant)
              .flatMap((run) => run.cases.map((sample) => sample[field])),
          ),
        ]),
      ),
    ]),
  );

  writeFileSync(
    output,
    gzipSync(
      JSON.stringify(
        {
          date: new Date().toISOString(),
          baselineRevision,
          node: process.version,
          repetitions,
          simulationHz: 30,
          displayHz: 60,
          secondsPerCase: 10,
          downstreamDelayMs: [40, 90],
          burstDelayMs: 20,
          uplinkDelayMs: 0,
          authoritativeServer: 'TypeScript GameSession',
          socketTransport: 'in-memory binary frames',
          hashes,
          baselineSources,
          outcomeComparison:
            'exact physical contact ticks and final pilot position/velocity across both variants and all repeats',
          summary,
          runs,
        },
        null,
        2,
      ) + '\n',
      { level: 9 },
    ),
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(output);
} finally {
  for (const entry of Object.values(entries)) rmSync(entry, { force: true });
}
