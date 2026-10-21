# Courser collection CPU evidence — 21 October 2026

The later [simplification archive](../pirate-collection-simplification/README.md)
describes the current implementation. This archive records the preceding CPU
optimization and its historical measurements.

The retained collector reduces complete-haul process CPU by **50.72%** against
the initial fast collector and **11.18%** against the original slow behavior.
All 12 pickup scenarios produce exactly the same complete results as the initial
fast collector. The primary eight-item fixture remains at 21.77 simulation
seconds, compared with the original 85.33 seconds.

The [report](../../../../docs/experiments/2026-10-21/pirate-collection-cpu.md)
explains the optimization, measurements, and limits.

## Evidence

- [Final CPU comparison](results/cpu-comparison.json): five alternating runs of
  three executables, ten hauls per scenario, four scenarios per invocation.
  Companion `final-cpu-*.log` files retain the raw benchmark output.
- [Final 12-scenario results, repeated three times](results/final-collection.log)
  and [exact equivalence summary](results/equivalence.json). Reproducing the
  [archived initial fast collector](results/archive-reproduction.log) matches
  all 36 complete result objects and the prior investigation's saved results.
- [Seeded 1,000-state differential oracle](baseline/collection-equivalence_test.go.txt)
  and its [passing log](results/differential-equivalence.log). The fixture embeds
  the archived exhaustive method and compares both control outputs bit for bit.
- [Before profile](results/profile-before-top.txt) and
  [after profile](results/profile-after-top.txt), with their `.pprof` files and
  benchmark logs alongside them. Collection planning accounted for approximately
  75% of the initial sampled CPU.
- [Initial fast collector](baseline/collection-controls.go.txt), companion
  [movement](baseline/movement.go.txt) and
  [prediction](baseline/prediction.go.txt) snapshots, and
  [initial](baseline/resources.json) and [final resource sizes](results/resources.json).
- Passing [production build](results/build.log), [lint](results/lint.log),
  [Go formatting](results/formatting.log), and [full test suite](results/tests.log)
  logs, plus the [contact-bound regression results](results/contact-bounds-tests.log).
- `combined-cpu-comparison.json`, `combined-validation.log`, and `cpu-*.log`
  retain the earlier combined prototype before the final pruning refinements.
  `pre-margin-cpu-comparison.json` retains a diagnostic run before the custom
  collision-margin correction; it is not the final acceptance measurement.

Median process CPU falls from **2.745547 to 1.353037 seconds**. The original
slow collector uses **1.523381 seconds** in this comparison. CPU includes fixture
setup and test-harness work for 40 complete hauls. These measurements do not
establish a CPU reduction for a live server's particular mixture of encounters.

## Reproduce pickup results and the oracle

Run from the repository root. Create absolute-path Go overlays without changing
checkout files:

```bash
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const archive = resolve('benchmarking/experiments/2026-10-21/pirate-collection-cpu/baseline');
const before = Object.fromEntries([
  'collection-controls.go', 'movement.go', 'prediction.go',
].map(name => [resolve('src/server/npc', name), resolve(archive, `${name}.txt`)]));
writeFileSync('/tmp/pirate-collection-fast-before.json', JSON.stringify({ Replace: before }));
const retained = Object.fromEntries([
  'collection-controls.go', 'collection-hull.go', 'collection.go',
  'movement.go', 'collection_test.go',
].map(name => [resolve('src/server/npc', name), resolve(archive, `retained-${name}.txt`)]));
writeFileSync('/tmp/pirate-collection-retained.json', JSON.stringify({ Replace: retained }));
writeFileSync('/tmp/pirate-collection-equivalence.json', JSON.stringify({
  Replace: {
    ...retained,
    [resolve('src/server/npc/collection-equivalence_test.go')]:
      resolve(archive, 'collection-equivalence_test.go.txt'),
  },
}));
JS

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-retained.json ./src/server/network \
  -run '^TestPirateCollection(Seeded|Validation)$' -count=3 -v

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-fast-before.json ./src/server/network \
  -run '^TestPirateCollection(Seeded|Validation)$' -count=3 -v

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-equivalence.json ./src/server/npc \
  -run '^TestCollectionControlsMatchExhaustive$' -count=1 -v
```

The oracle uses `rand.NewPCG(20261021, 99)`. It samples real Courser/Arrow hulls,
polygon items and circles, velocity, spin, range, hatch animation, damaged hull
and modules, disabled hatches, and absent target entities. It reuses independent
pilots and alternates call order. The reference method comes from the initial
fast collector snapshot. The oracle overlay restores the retained collector,
hull helper, movement/recovery code, and matching focused tests before adding
the oracle fixture. These `retained-*` snapshots reproduce this historical
experiment after later helper and controller API changes.

## Reproduce CPU measurements

Compile executables before measuring:

```bash
CGO_ENABLED=0 GOEXPERIMENT=simd GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-fast-before.json -c ./src/server/network \
  -o /tmp/pirate-collection-fast-before.test

CGO_ENABLED=0 GOEXPERIMENT=simd GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-retained.json -c ./src/server/network \
  -o /tmp/pirate-collection-optimized.test
```

The [earlier archive](../pirate-collection/README.md#reproduce-the-preserved-baseline)
provides the overlay for the original slow behavior. Compile that overlay into
a third executable to reproduce the three-way comparison.

Finish other builds and tests, then run each executable sequentially with
`GOGC=800`, `-test.run='^$'`, `-test.bench='^BenchmarkPirateCollection$'`, and
`-test.benchtime=10x`. Repeat five times, alternating the execution order using
the orders recorded in `cpu-comparison.json`. Each invocation runs ten complete
hauls per scenario. Sum child user and system CPU, then compare the median
invocation totals; `ns/op` separately reports wall time per haul. For example:

```bash
GOGC=800 /usr/bin/time -f 'user=%U system=%S' /tmp/pirate-collection-optimized.test \
  -test.run='^$' -test.bench='^BenchmarkPirateCollection$' -test.benchtime=10x
```

GNU `time` rounds these displayed CPU values; the archived JSON retains the
higher-resolution child CPU measurements used for the reported percentages.
The AI cadence, prediction horizon, candidate controls, and pickup mechanics are
unchanged. The benchmark measures complete-haul cost, including setup, rather
than an isolated planner call or live-fleet CPU.

The production build, lint, Go formatting check, all 68 Node checks, and every
Go package test pass. The complete suite uses `npm test -- --skip-build` after
the successful production build. The archived overlay and 1,000-state oracle
also pass using the commands above. All 14 client resources are byte-for-byte
identical (305,788 raw bytes total). The server grows by 4,096 raw bytes and 2,351
gzip bytes; exact sizes and hashes are in `resources.json`.
