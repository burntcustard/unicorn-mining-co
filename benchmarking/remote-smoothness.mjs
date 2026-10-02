import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const [baselineDirectory, output] = process.argv.slice(2);

assert(
  baselineDirectory && output,
  'Usage: node benchmarking/remote-smoothness.mjs BASELINE_DIRECTORY OUTPUT.json.gz',
);
const sourceFiles = baselineDirectory.endsWith('.gz')
  ? Object.keys(
      JSON.parse(gunzipSync(readFileSync(baselineDirectory))).sources.before,
    )
  : [
      'src/client/network.ts',
      'src/client/remote-motion.ts',
      'src/client/frame-prediction.ts',
      'src/server/game-session.ts',
      'internal/server/game-session.go',
      'src/client/prediction.ts',
      'src/server/binary-replication.ts',
      'internal/server/binary-replication.go',
    ];
const baselineArchive = baselineDirectory.endsWith('.gz')
  ? JSON.parse(gunzipSync(readFileSync(baselineDirectory)))
  : undefined;
const reuseBefore = !!process.env.REMOTE_REUSE_BEFORE;
const fixtureHashes = Object.fromEntries(
  [
    'tests/remote-perspectives.test.ts',
    'benchmarking/remote-handoff-workload.ts',
    'benchmarking/remote-motion-workload.ts',
    'benchmarking/remote-trajectory-workload.ts',
  ].map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
const runFile = promisify(execFile);
const baselineSources = baselineDirectory.endsWith('.gz')
  ? JSON.parse(gunzipSync(readFileSync(baselineDirectory))).sources.before
  : Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        readFileSync(join(baselineDirectory, basename(path)), 'utf8'),
      ]),
    );
const sources = Object.fromEntries(
  ['before', 'after'].map((variant) => [
    variant,
    Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        variant === 'before'
          ? baselineSources[path]
          : readFileSync(path, 'utf8'),
      ]),
    ),
  ]),
);
const interpolationPath = 'src/shared/utilities/interpolate-pose.ts';

sources.after[interpolationPath] = readFileSync(interpolationPath, 'utf8');
const hashes = Object.fromEntries(
  Object.entries(sources).map(([variant, files]) => [
    variant,
    Object.fromEntries(
      Object.entries(files).map(([path, source]) => [
        path,
        createHash('sha256').update(source).digest('hex'),
      ]),
    ),
  ]),
);
const selected = process.env.REMOTE_WORKLOAD
  ? process.env.REMOTE_WORKLOAD.split(',')
  : ['handoff', 'clock', 'trajectory', 'perspectives'];
const entries = [];
const runs = [];
const variants = reuseBefore ? ['after'] : ['before', 'after'];

if (reuseBefore) {
  assert(baselineArchive, 'cached before runs require a replay archive');
  assert.deepEqual(
    baselineArchive.fixtureHashes,
    fixtureHashes,
    'cached workload fixtures must be identical',
  );
  assert.deepEqual(baselineArchive.workloads, selected);
  runs.push(...baselineArchive.runs.filter((run) => run.variant === 'before'));
  assert.equal(runs.length, 3);
}
const workloads = {
  trajectory: `import {replayTrajectory} from ${JSON.stringify(resolve('benchmarking/remote-trajectory-workload.ts'))};
const cases=[];
for(const fps of [30,60,144]) for(const acceleration of [40,120]) for(const turn of [0,0.4]) cases.push(replayTrajectory([fps,acceleration,turn]));
console.log(JSON.stringify(cases));`,
  handoff: `import {replayHandoff} from ${JSON.stringify(resolve('benchmarking/remote-handoff-workload.ts'))};
const cases=[];
for(const speed of [120,272]) for(const separation of [0,85,110,160,400]) for(const latency of [40,90]) for(const fps of [30,60,144]) for(const direction of [-1,1]) cases.push(replayHandoff([speed,separation,latency,fps,direction]));
console.log(JSON.stringify(cases));`,
  clock: `import {motionFixture,replayMotion} from ${JSON.stringify(resolve('benchmarking/remote-motion-workload.ts'))};
const cases=[];
for(const players of [4,8,16,32]) for(const delivery of ['steady','jitter','burst','slow','outage']) cases.push({players,delivery,...replayMotion(motionFixture([players,delivery]),true)});
console.log(JSON.stringify(cases));`,
};

try {
  const bundles = {};

  for (const variant of variants) {
    for (const workload of selected) {
      const entry = `bin/remote-smoothness-${variant}-${workload}-${process.pid}.mjs`;

      entries.push(entry);
      const virtual = resolve(
        `benchmarking/__remote_smoothness_${workload}.ts`,
      );
      const bundle = await rolldown({
        input:
          workload === 'perspectives'
            ? 'tests/remote-perspectives.test.ts'
            : virtual,
        platform: 'node',
        external: ['ws', /^node:/],
        plugins: [
          {
            name: 'remote-smoothness-variant',
            resolveId: (id) => (id === virtual ? virtual : undefined),
            load: (id) => (id === virtual ? workloads[workload] : undefined),
            transform(code, id) {
              if (variant !== 'before') return;

              for (const path of sourceFiles) {
                if (id.endsWith('/' + path)) return sources.before[path];
              }

              if (id.endsWith('/tests/remote-perspectives.test.ts')) {
                return code
                  .replace('maxReceiveJump < 1e-5', 'true')
                  .replace('maxSnapshotJump < 1e-5', 'true')
                  .replace(
                    "if (delivery === 'steady')",
                    "if (delivery === 'baseline')",
                  );
              }
            },
          },
        ],
      });

      await bundle.write({ file: entry, format: 'esm', codeSplitting: false });
      await bundle.close();
      bundles[variant + workload] = entry;
    }
  }

  // Replays advance a mocked clock, so CPU scheduling cannot change results.
  // Independent variants run concurrently; browser captures run afterward.
  const repeats = [];

  for (let repetition = 0; repetition < 3; repetition++) {
    for (const variant of repetition % 2 ? [...variants].reverse() : variants) {
      repeats.push(
        (async () => {
          const results = {};

          console.log(`${variant} repetition ${repetition + 1}/3`);

          for (const workload of selected) {
            const { stdout: data } = await runFile(
              process.execPath,
              [bundles[variant + workload]],
              {
                maxBuffer: 16 * 1024 * 1024,
                env: {
                  ...process.env,
                  REMOTE_PLAYERS: '4,8,16,32',
                  REMOTE_FPS: '60,144',
                },
              },
            );

            results[workload] =
              workload === 'perspectives'
                ? data
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line))
                : JSON.parse(data);
            assert.equal(
              results[workload].length,
              { handoff: 120, clock: 20, trajectory: 12, perspectives: 24 }[
                workload
              ],
            );
          }
          console.log(`${variant} repetition ${repetition + 1}/3 complete`);
          return { variant, repetition, results };
        })(),
      );
    }
  }
  const completed = await Promise.allSettled(repeats);

  for (const result of completed) {
    if (result.status === 'fulfilled') runs.push(result.value);
  }
  const failed = completed.find((result) => result.status === 'rejected');

  if (failed) throw failed.reason;

  for (const run of runs) {
    assert.deepEqual(
      run.results,
      runs.find((value) => value.variant === run.variant).results,
      'each variant must repeat deterministically',
    );
  }
  // The new presentation and heartbeat changes must not change these replayed
  // authoritative outcomes. Older archived baselines can change cadence, so
  // opt in when the comparison starts from the current 30 Hz implementation.

  if (process.env.REMOTE_SAME_PHYSICS) {
    for (const before of runs.find((run) => run.variant === 'before').results
      .perspectives) {
      const after = runs
        .find((run) => run.variant === 'after')
        .results.perspectives.find(
          (value) =>
            value.players === before.players &&
            value.delivery === before.delivery &&
            value.fps === before.fps,
        );

      for (const field of [
        'collisionTicks',
        'finalPositions',
        'finalVelocities',
      ]) {
        assert.deepEqual(
          after[field],
          before[field],
          `unchanged authoritative ${field}`,
        );
      }
    }
  }
  const comparison = {};

  for (const workload of selected) {
    comparison[workload] = runs[0].results[workload].map((before, i) => ({
      before,
      after: runs.find((run) => run.variant === 'after').results[workload][i],
    }));
  }
  writeFileSync(
    output,
    gzipSync(
      JSON.stringify(
        {
          date: new Date().toISOString(),
          node: process.version,
          repetitions: 3,
          baseline:
            process.env.REMOTE_BASELINE_LABEL ||
            'working sources after the first collision-presentation fix, before this follow-up',
          workloads: selected,
          fixtureHashes,
          reusedBefore: reuseBefore
            ? {
                archive: baselineDirectory,
                hash: createHash('sha256')
                  .update(readFileSync(baselineDirectory))
                  .digest('hex'),
              }
            : undefined,
          hashes,
          sources,
          runs,
          comparison,
          transport:
            selected.length === 1 && selected[0] === 'clock'
              ? 'synthetic ordered entity samples'
              : 'ordered in-memory binary frames with bidirectional asymmetric delay, jitter and 80ms stalls',
          authoritativeServer:
            selected.length === 1 && selected[0] === 'clock'
              ? 'motion presentation only'
              : 'TypeScript GameSession; Go cadence verified separately',
        },
        null,
        2,
      ) + '\n',
      { level: 9 },
    ),
  );

  for (const variant of ['before', 'after']) {
    const results = runs.find((run) => run.variant === variant).results;

    if (selected.length === 1 && selected[0] === 'clock') {
      console.log(
        JSON.stringify({
          variant,
          clock: results.clock.filter((value) => value.players === 4),
        }),
      );
      continue;
    }
    console.log(
      JSON.stringify({
        variant,
        handoffBackwards: results.handoff.reduce(
          (sum, value) => sum + value.backwards,
          0,
        ),
        maxHandoffSpeedRatio: Math.max(
          ...results.handoff.map((value) => value.maxSpeedRatio),
        ),
        maxHandoffSpeedChange: Math.max(
          ...results.handoff.map((value) => value.maxSpeedChange),
        ),
        maxReceiveJump: Math.max(
          ...results.perspectives.map((value) => value.maxReceiveJump),
        ),
        maxSnapshotJump: Math.max(
          ...results.perspectives.map((value) => value.maxSnapshotJump),
        ),
        clock: results.clock.filter((value) => value.players === 4),
        perspectives: results.perspectives.map(
          ({
            players,
            delivery,
            fps,
            rmsChange,
            maxChange,
            maxSnapshotGap,
          }) => ({
            players,
            delivery,
            fps,
            rmsChange,
            maxChange,
            maxSnapshotGap,
          }),
        ),
      }),
    );
  }
  console.log(output);
} finally {
  entries.forEach((entry) => rmSync(entry, { force: true }));
}
