# Courser collection simplification evidence — 21 October 2026

Four production collection/movement files shrink from **588 to 513 lines**.
The controller and collision helper shrink from **272 to 177 lines**. All four
primary eight-item completion times remain unchanged; seed 977 improves from
55.43 to 45.10 simulation seconds. The additional 32-layout sample is 2.25%
slower in aggregate, so this work does not claim a general pickup speedup.

The [report](../../../../docs/experiments/2026-10-21/pirate-collection-simplification.md)
describes the retained implementation, rejected alternatives, and limits.

## Evidence

- `baseline/` preserves the preceding controller, collision helper, recovery,
  movement, prediction, and focused tests; [source hashes](baseline/sha256.json)
  identify the snapshots.
- The [32-layout fixture](baseline/generalization_test.go.txt) uses seeds 10001
  through 10032, cycling spreads 120, 180, 240, and 300. Its
  [baseline log](baseline/generalization.log) retains complete seeded results.
- [Final 44-layout results, repeated three times](results/final-collection.log)
  and the [per-case comparison](results/collection-comparison.json). All 132
  final result objects repeat identically.
- The [40,000-state frame-parity fixture](variants/frame-parity_test.go.txt)
  and its [passing log](results/frame-parity.log): contact presence agrees and
  depth differs by at most `1e-8` across all four polygon/circle combinations.
- `results/*-cpu-comparison.json` and companion logs retain prototype CPU
  comparisons. These are intermediate experiments, not final acceptance figures.
- Final five-round alternating CPU comparisons:
  [unrestricted affinity](results/final-cpu-unrestricted.json), with
  `GOMAXPROCS=16` and 20 hauls per case; and
  [CPU 0 pinned](results/final-cpu-pinned.json), with `GOMAXPROCS=1` and ten hauls
  per case. Companion logs retain benchmark output and allocations.
- [Initial resource sizes](baseline/resources.json) and the
  [focused-test log](results/focused-tests.log) preserve setup and early validation.
- Passing [build](results/build.log), [lint](results/lint.log),
  [Go formatting](results/formatting.log), and [full test-suite](results/tests.log)
  logs; [final resource sizes](results/resources.json); and
  [historical oracle reproduction](results/historical-oracle-reproduction.log).
- The [recovery comparison](results/recovery-comparison.json) compares two-,
  1.5-, and one-second stall deadlines; `recovery-*.log` retains raw results.
  Totals across 44 layouts are 1,632.33, 1,645.10, and 1,765.93 simulation seconds.
  Both shorter deadlines violate three existing pickup budgets; two seconds is
  retained.

The retained algorithm fixes each hull in the ship frame, transforms the item,
uses the native contact query, and shares one actual hatch center with movement.
A single cost array and global geometric minimum replace suffix storage and
the candidate-local closest score. Shape bounds use uniform `sqrt(2)` skin
padding. AI cadence, forecast horizon, control choices, recovery deadline, and
pickup tolerances keep their existing settings.

## Reproduce all 44 pickup scenarios

Run these commands from the repository root. The before overlay restores all
four production files and matching focused tests because the helper API changed.
Both overlays add the same 32-layout fixture without editing checkout files.

```bash
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const archive = resolve('benchmarking/experiments/2026-10-21/pirate-collection-simplification/baseline');
const generalization = {
  [resolve('src/server/network/collection-generalization_test.go')]:
    resolve(archive, 'generalization_test.go.txt'),
};
const before = Object.fromEntries([
  'collection-controls.go', 'collection-hull.go', 'collection.go',
  'movement.go', 'collection_test.go',
].map(name => [resolve('src/server/npc', name), resolve(archive, `${name}.txt`)]));
writeFileSync('/tmp/pirate-collection-simplification-before.json', JSON.stringify({
  Replace: { ...before, ...generalization },
}));
writeFileSync('/tmp/pirate-collection-simplification-after.json', JSON.stringify({
  Replace: generalization,
}));
JS

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-simplification-before.json ./src/server/network \
  -run '^TestPirateCollection(Seeded|Validation|Generalization)$' -count=3 -v

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-simplification-after.json ./src/server/network \
  -run '^TestPirateCollection(Seeded|Validation|Generalization)$' -count=3 -v
```

The original 12 fixtures take 452.30 seconds before and 441.97 after. The new
32 take 1,164.17 before and 1,190.37 after (+2.25%). All 44 collect every item;
their summed time rises by 0.98%. Results measure simulated completion time,
independently of host speed. The clear-space fixture replenishes fuel and extends
the encounter timeout; it excludes combat, station travel, transport, and return.

## Reproduce CPU benchmarks

Compile both executables before measuring:

```bash
CGO_ENABLED=0 GOEXPERIMENT=simd GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -overlay=/tmp/pirate-collection-simplification-before.json -c ./src/server/network \
  -o /tmp/pirate-collection-simplification-before.test

CGO_ENABLED=0 GOEXPERIMENT=simd GOCACHE=/tmp/unicorn-go-cache go test -trimpath \
  -c ./src/server/network -o /tmp/pirate-collection-simplification-after.test
```

Finish builds and tests, then run the executables sequentially for five rounds,
alternating before/after order as recorded in the final JSON files. Use
`GOGC=800`, `-test.run='^$'`, `-test.bench='^BenchmarkPirateCollection$'`, and
`-test.benchmem`. The unrestricted comparison uses `GOMAXPROCS=16` and
`-test.benchtime=20x` (80 complete hauls per invocation). The pinned comparison
uses CPU 0, `GOMAXPROCS=1`, and `-test.benchtime=10x` (40 hauls). For example:

```bash
GOGC=800 GOMAXPROCS=16 /usr/bin/time -f 'user=%U system=%S' \
  /tmp/pirate-collection-simplification-after.test \
  -test.run='^$' -test.bench='^BenchmarkPirateCollection$' -test.benchtime=20x -test.benchmem

GOGC=800 GOMAXPROCS=1 /usr/bin/time -f 'user=%U system=%S' \
  taskset -c 0 /tmp/pirate-collection-simplification-after.test \
  -test.run='^$' -test.bench='^BenchmarkPirateCollection$' -test.benchtime=10x -test.benchmem
```

Use another single allowed CPU consistently if CPU 0 is unavailable. Compare
median child user-plus-system CPU totals; GNU `time` rounds displayed CPU while
the JSON retains higher-resolution measurements. `ns/op` separately measures
wall time per haul. CPU includes fixture setup and the harness, and does not
predict the effect for a live server's particular mix of encounters.

Unrestricted medians fall from 2.603099 to 2.558454 seconds (-1.72%); pinned
medians fall from 1.187085 to 1.180666 seconds (-0.54%). This is roughly unchanged
CPU with slightly lower measured totals. Primary allocations fall from 63,328
to 62,242 objects and from 6,462,821 to 6,418,186 bytes per haul; all four primary
cases allocate approximately 1.6–2.1% fewer objects.

The production build, lint, Go formatting check, all 68 Node checks, and every
Go package test pass. The earlier 1,000-state
historical oracle remains reproducible using the five retained NPC snapshots
documented in the [preceding archive](../pirate-collection-cpu/README.md).

All 14 client resources retain identical bytes, hashes, and gzip sizes (305,788
raw bytes total). The server shrinks by 4,096 raw bytes and 1,676 gzip bytes;
both resource snapshots use the same deterministic gzip level-9 compressor.
