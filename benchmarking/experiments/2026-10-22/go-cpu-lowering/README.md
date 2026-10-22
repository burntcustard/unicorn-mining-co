# Go compiler and CPU evidence — October 22, 2026

The [report](../../../../docs/experiments/2026-10-22/go-server-cpu-lowering.md)
explains the retained changes, measurements and rejected experiments. This starts
from the **optimized uncommitted result** in the sibling `go-cpu` investigation;
its previous CPU savings are not counted again. The additional 20% target was
not reached.

## Primary evidence

- `results/acceptance.json.gz`: the complete existing 16-case session matrix,
  3,000 measured ticks and five alternating pairs. The summary checks exact
  equality of ship states, contacts, events, entities, packets, byte totals and
  near-zero collision counts.
- `results/sustained.json.gz`: three further pairs of the existing 32-player
  module case, 6,000 measured ticks.
- `results/pirate.json.gz`: five alternating pairs of the five existing
  9,000-tick combat cases. Raw activity and CPU metrics remain available.
- `results/transport.json.gz`: real paced TCP with 8/32 clients, idle/flight,
  three alternating pairs, 120 warmup and 180 measured ticks.
- `profiles/`: separate training and baseline diagnostic profiles. Starting and
  retained compiler inputs are identified by `sources.json` in
  [`benchmarking/profiles`](../../../profiles/README.md).
  `results/assembly/` holds compressed disassembly.
- `results/pmu-*.json.gz`: inherited user-mode hardware counts, including
  startup/warmup. This is a different scope from the measured-tick CPU windows.
- `results/screens/`: diagnostic prototype and compiler/ISA screens. These
  compare different checkpoints; they are not additive or acceptance results.
- `patches/`: saved experimental source fragments. Some are combined prototypes;
  these do not form a complete rebuild kit for every rejected checkpoint.
- `support/`: logs, harness snapshots, exhaustive recovery oracle, source build
  scripts, resource sizes and summary scripts. Original scratch orchestration
  is retained as `.ts.txt` with its original temporary paths.

`merge-invalid-wrong-package` is explicitly invalid: the wrong Go test package
reported no tests and the old runner read an earlier result. It supports no
performance or parity conclusion. The runner fix and corrected complete merge
capture are included. The initial all-Go test log contains a sandbox socket
failure; the final full test log records the permitted rerun.

## Reproduce the retained comparison

From this checkout, or clean revision
`5cfd246c76a99d7f202bcf8e05eaeaa148316421` with its generated catalog/example data:

```sh
npm run catalog:go
node --import tsx scripts/generate-example-modules.ts
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu-lowering/build.ts before /tmp/lower-before.test
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu-lowering/build.ts after /tmp/lower-after.test
TICKS=3000 REPETITIONS=5 GOMAXPROCS=2 GOGC=200 CPU_AFFINITY=0,1 \
  node benchmarking/tools/go-cpu-paired.ts lower-reproduction \
  /tmp/lower-before.test /tmp/lower-after.test
node benchmarking/tools/pirate-cpu.ts /tmp/lower-before.test \
  /tmp/lower-after.test benchmarking/local/lower-pirate.json
```

`build.ts` applies the matching source/profile overlays without editing the
checkout. It verifies all production Go source hashes and the profile hash,
requires Go 1.27.1, and builds CGO disabled, SIMD enabled, AMD64 v1. Executable
hashes can differ because overlay/profile paths appear in build metadata.
Source overlays include the preceding investigation's retained changes on both
sides. The starting source hash must match that investigation's final hash.

To reproduce TCP, use `build.ts before OUTPUT transport` and `after OUTPUT
transport`, then the existing `websocket-transport-compare.ts` with `GAME=1`,
`PLAYERS=8,32`, `REPETITIONS=3`, `PACED_TICKS=180`, `GOGC=200`,
`GOMAXPROCS=2`, `BENCH_CPU_AFFINITY=0,1`; pin the Node driver to other cores.

To run the recovery oracle against the archived final source:

```sh
cp benchmarking/experiments/2026-10-22/go-cpu-lowering/support/prepare-final-oracle.ts.txt \
  /tmp/unicorn-prepare-lowering-oracle.ts
node /tmp/unicorn-prepare-lowering-oracle.ts /tmp/unicorn-lowering-oracle.json
GOCACHE=/tmp/unicorn-reproduce-cache CGO_ENABLED=0 GOEXPERIMENT=simd \
  go test -overlay=/tmp/unicorn-lowering-oracle.json ./src/server/physics \
  -run '^TestRecoveryAgainstExhaustive$' -count=1
```

Use the summary scripts on the compressed acceptance captures. They assert
exact outcomes and recompute medians; the session summary also computes a paired
bootstrap interval. `manifest.json` records archive artifact hashes. Run one CPU
measurement at a time, with builds, tests, profiles and compression outside the
timing window. Affinity 0/1 is host-specific: choose two distinct physical cores
on another machine. No host performance settings were changed.
