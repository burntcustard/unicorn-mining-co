# Go CPU evidence — October 22, 2026

See the [report](../../../../docs/experiments/2026-10-22/go-server-cpu.md) for
results, research, changes, and limits. The 50% overall target was not reached:
the complete session matrix saves 28.15%, and the sustained 32-player module
case saves 51.39%.

## Primary captures

- `results/acceptance-3000.json.gz`: five alternating pairs per 4/8/16/32-player
  convoy/spread/contact/module case, 3,000 measured ticks. Final CGO-0 binaries,
  GOGC=200, GOMAXPROCS=2, affinity 0/1. Summaries assert exact equality of the
  compared final states and counts, including tiny collision notifications.
- `results/acceptance-6000.json.gz`: three further pairs of the existing
  32-player module case at 6,000 ticks, with the same executables/settings.
- `results/pirate.json.gz` and companion logs: five alternating pairs of the
  five existing combat cases at 9,000 measured ticks. Activity metrics match.
- `results/transport.json.gz`: real loopback game-server/control/snapshot
  measurements, separate from the in-memory session fixtures.
- Summary JSON files record medians and the session paired bootstrap calculation.
  The bootstrap script is retained under `support/`.

Original capture metadata, temporary executable paths, and source labels are
preserved inside raw files. Their paths reflect the investigation's workspace;
the current archive paths are listed here. Initial GC-800 screens and incomplete
transport diagnostics are excluded from the primary comparisons.

## Rebuild without changing the checkout

Use this checkout's unchanged fixtures and Go 1.27.1. The original clean revision
is `5cfd246c76a99d7f202bcf8e05eaeaa148316421`. If reproducing later, start from that
revision and regenerate its catalog/example data before applying these overlays.

```sh
npm run catalog:go
node --import tsx scripts/generate-example-modules.ts
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu/build.ts before /tmp/cpu-before.test
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu/build.ts after /tmp/cpu-after.test

GOGC=200 GOMAXPROCS=2 CPU_AFFINITY=0,1 TICKS=3000 REPETITIONS=5 \
  node benchmarking/tools/go-cpu-paired.ts reproduction \
    /tmp/cpu-before.test /tmp/cpu-after.test

GOGC=200 GOMAXPROCS=2 CPU_AFFINITY=0,1 \
  PLAYERS=32 WORKLOADS=module TICKS=6000 REPETITIONS=3 \
  node benchmarking/tools/go-cpu-paired.ts reproduction-long \
    /tmp/cpu-before.test /tmp/cpu-after.test

node benchmarking/tools/pirate-cpu.ts /tmp/cpu-before.test \
  /tmp/cpu-after.test benchmarking/local/reproduction-pirate.json
```

`build.ts` applies source overlays and the corresponding PGO profile, checks
source/profile hashes, and builds with CGO disabled, SIMD enabled, and amd64 v1.
It checks all non-test Go sources below `src/server`, hashing each sorted path,
NUL, contents, and NUL. This includes helper packages as well as production
packages. It does not modify tracked source. Output executable hashes may differ
from the captures because overlay and PGO input paths are part of build metadata.

Run only one timing job at a time. Do builds, tests, profiling, and compression
outside the timing runs. Affinity 0/1 is specific to the captured host; choose two
available distinct physical cores elsewhere.

For TCP reproduction, build the existing transport harness with the same Go
source overlays and matching profile, then use the existing comparison tool:

```sh
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu/build.ts before /tmp/transport-before transport
GOCACHE=/tmp/unicorn-reproduce-cache node \
  benchmarking/experiments/2026-10-22/go-cpu/build.ts after /tmp/transport-after transport
GAME=1 REPETITIONS=3 PACED_TICKS=180 GOGC=200 GOMAXPROCS=2 \
  BENCH_CPU_AFFINITY=0,1 taskset -c 2-15 \
  node benchmarking/tools/websocket-transport-compare.ts \
    /tmp/transport-before /tmp/transport-after benchmarking/local/transport.json.gz
```

The client runs off the server cores. This uses owned ephemeral loopback ports,
not the development server or Vite. The runner validates ordinary decoded control
frames after welcome and separately counts them; sounds are not snapshots.
The capture's exact client source is saved as
`support/harness/websocket-transport-captured.ts.txt`. The retained runner adds
an explicit `string | undefined` annotation to its failure variable for the
repository type check; this has no runtime effect.

## Profiles, prototypes, and correctness

`sources.json` identifies the immutable compiler inputs in
[`benchmarking/profiles`](../../../profiles/README.md).
The retained profile merges the separate convoy/spread/contact/module and
normal/dense combat training profiles. These profiles use GOGC=800 and the
documented intermediate body-bounds checkpoint; the acceptance captures use
GOGC=200 and the final sources. PGO is measured rather than assumed to transfer.

The recovery before/checkpoint profiles show the change in sampled CPU under
recovery. `patches/body-bounds.patch` preserves that intermediate source. Other
screen captures under `diagnostics/` identify binaries by hash but are not all
source-complete reproductions; do not use them instead of the final comparisons.
The body-rejection long screen briefly overlapped tests and is diagnostic only.

`patches/typed-captures.patch` preserves the rejected allocation prototype. Its
eight-case, five-pair screen used GOGC=200 but CGO-enabled test executables, and
saved only 0.50% aggregate CPU. It is not a retained server or protocol change.

The exhaustive correctness oracle is a test-only overlay. It embeds the original
recovery function, runs 1,000 seeded scenes through three recoveries, moves and
rotates an obstacle between steps, and compares body transforms exactly.

```sh
node benchmarking/experiments/2026-10-22/go-cpu/support/prepare-oracle.ts
GOCACHE=/tmp/unicorn-reproduce-cache CGO_ENABLED=0 GOEXPERIMENT=simd \
  go test -overlay=/tmp/unicorn-recovery-overlay.json \
  ./src/server/physics -run '^TestRecoveryAgainstExhaustive$' -count=1
```

Run both commands from the repository root. The oracle also overlays the retained
source snapshots. Permanent focused recovery regressions are in
`src/server/physics/overlap-recovery_test.go`.

`support/` also retains successful build/test/lint/race logs, machine and compiler
information, resource hashes/sizes, source identities, and capture binary hashes.
The manifest records retained artifact hashes. No benchmark executable is stored
in the repository.
