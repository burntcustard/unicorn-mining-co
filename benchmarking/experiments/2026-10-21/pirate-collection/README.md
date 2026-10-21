# Courser pirate collection experiment — 21 October 2026

The later [simplification archive](../pirate-collection-simplification/README.md)
describes the current implementation. This archive preserves the original
behavior investigation and its historical measurements.

The retained controller collects the primary seeded eight-item fixture in
**21.77 simulation seconds instead of 85.33 seconds: 3.92× faster**. All 12
scenarios improve, and three repeats produce exactly identical complete result
objects, including pickup times, pickup order, and distance traveled.

The [CPU follow-up](../pirate-collection-cpu/README.md) preserves those pickup
results while reducing whole-haul CPU by **50.72%** against this initial fast
implementation and **11.18%** against the original slow behavior. The CPU and
build figures below document the historical initial implementation.

The [experiment report](../../../../docs/experiments/2026-10-21/pirate-collection.md)
describes the behavior, results, and tradeoffs.

## Evidence

- [Original four-case baseline](baseline.txt).
- [Eight additional baseline seeds](results/validation-baseline.log).
- [Final 12-case results, repeated three times](results/final-collection.log).
- [Compact before/after comparison](results/final-summary.json).
- [Whole-haul CPU and wall-time comparison](results/cpu-comparison.json), with
  three alternating before/final samples and companion raw logs.
- [Selected intermediate comparisons](results/selected-comparisons.json); companion
  logs retain full fixture positions and per-pickup measurements.
- [Preserved original source hashes](baseline/sha256.json). The baseline includes
  the original movement, collection recovery, pirate selection/state, and a copy
  of the 12-case fixture without the new performance limits.
- [Baseline resource sizes](baseline/resources.json) and
  [final resource sizes](results/resources.json).

The fixture executes the real `GameSession.Tick` pirate state machine, ordinary
ship controls, module animation, physical hull/item contacts, and cargo pickups.
It uses eight gold items with PCG-seeded positions and rotations and a seeded
initial ship heading. All cases use the same generated world seed and a clear
area away from stations and asteroids. An observer with a closed cargo hatch
stays 1,200 units away.

The Courser normally carries ammunition in one of its eight cargo spaces. The
fixture removes this unused ammunition so all eight loose items can be collected.
Fuel is replenished and the encounter timeout is extended. These isolate
collection behavior; the results do not measure travel from a station, combat,
cargo surrender/release delays, or the return trip.

`seconds` and `pickupTimes` measure simulation time, independently of machine
speed. `distance` is the sum of movement over normal ticks. `slowSeconds` counts
ticks below 10 units/second while a loose fixture item is within 80 units.
`longestGap` includes the initial approach and every interval between pickups.
The archived fixture and final fixture produce the same seeded item layouts.

## Reproduce the final results

From the repository root:

```bash
CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath ./src/server/network \
  -run '^TestPirateCollection(Seeded|Validation)$' -count=3 -v

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath ./src/server/network -run '^$' \
  -bench '^BenchmarkPirateCollection$' -benchtime=3x -count=3
```

The tests enforce eight actual pickups and per-case simulation-time budgets.
The benchmark reports elapsed simulation seconds, travel distance, slow time,
and maximum pickup gap separately from wall-clock `ns/op`.

Near stations, collection requests a controlled closing speed of 40–50
units/second, plus normal obstacle avoidance. This prevents fast
glancing contacts from knocking items into docking interiors. Both existing
surrender/sale scenarios and the subsequent-mining encounter regression pass.

## Historical CPU and build tradeoffs

The initial predictive controller spent more CPU to collect items sooner in the
game. Median process CPU for a complete four-case benchmark invocation rose from
0.479044 to 0.837899 seconds, **74.91% more**. The follow-up linked above supersedes
this CPU increase. Each historical invocation ran three complete hauls per case;
CPU included fixture setup and the test harness.

| Scenario | Before, wall milliseconds/haul | Final, wall milliseconds/haul |
| -------- | -----------------------------: | ----------------------------: |
| Primary  |                          44.98 |                         54.82 |
| Compact  |                          36.43 |                         71.52 |
| Wide     |                          38.43 |                         73.60 |
| Heldout  |                          30.37 |                         66.79 |

These are medians of three alternating before/final executable runs on the same
host, with `CGO_ENABLED=0`, `GOEXPERIMENT=simd`, `GOGC=800`, `-trimpath`, and
`-test.benchtime=3x`. Wall time includes the complete fixture and haul, rather
than an isolated controller call. The comparison excludes TCP transport and
does not establish the cost of a live server's mixture of encounters.

At that stage, all 14 client resource sizes were unchanged. The server grew by
12,288 raw bytes and 5,441 gzip bytes. The production build, lint, Go formatting
check, 68 Node checks, and all Go package tests passed.

## Reproduce the preserved baseline

Create an absolute-path Go overlay without changing the checkout:

```bash
node <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const archive = path.join(root, 'benchmarking/experiments/2026-10-21/pirate-collection/baseline');
const files = {
  'src/server/npc/movement.go': 'movement.go.txt',
  'src/server/npc/collection.go': 'collection.go.txt',
  'src/server/network/pirate-movement.go': 'pirate-movement.go.txt',
  'src/server/network/pirates.go': 'pirates.go.txt',
  'src/server/network/pirate-collection-benchmark_test.go': 'pirate-collection-benchmark_test.go.txt',
};
const Replace = Object.fromEntries(Object.entries(files).map(([source, saved]) =>
  [path.join(root, source), path.join(archive, saved)]));
fs.writeFileSync('/tmp/pirate-collection-before.json', JSON.stringify({ Replace }));
JS

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath -overlay=/tmp/pirate-collection-before.json \
  ./src/server/network -run '^TestPirateCollection(Seeded|Validation)$' -count=3 -v

CGO_ENABLED=0 GOEXPERIMENT=simd GOGC=800 GOCACHE=/tmp/unicorn-go-cache go test -trimpath -overlay=/tmp/pirate-collection-before.json \
  ./src/server/network -run '^$' -bench '^BenchmarkPirateCollection$' \
  -benchtime=3x -count=3
```

The archived fixture deliberately omits the final controller's performance
budgets. Applying only the original movement files to the current tests would
fail those budgets. Reproduction with the complete overlay was checked against
every field of all 12 saved baseline results.

For wall-clock performance comparisons, finish other builds and tests first,
compile separate before/after test executables, and run them sequentially with
the same Go/environment settings. Collection becomes faster in the simulated
game while its predictive controller performs more CPU work per decision.
