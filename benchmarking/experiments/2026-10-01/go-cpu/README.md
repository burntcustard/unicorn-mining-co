# CPU experiments — 2026-10-01

The [follow-up report](../../../../docs/experiments/2026-10-01/go-server-cpu-comparison-2026-10-01-followup.md)
records retained changes, unsuccessful experiments, and final comparisons. The
[experiment index](results/2026-10-01-cpu-followup-experiments.json) lists raw
samples, runtime settings, executable hashes, run counts, and CPU deltas. JSON
archives preserve outcomes as well as timings. Negative CPU changes are better.

[CPU patches](patches/), [precision/SIMD patches](../precision-simd/patches/),
and [packed-physics patches](../packed-physics/patches/) preserve the investigated
implementations. They are
focused source excerpts from successive experimental checkpoints, rather than
standalone replacements for the final implementation. Some include other changes
already present at that checkpoint. Use their corresponding executable hashes
and settings in the result files when interpreting measurements; percentages
from different baselines cannot be added together.

The two `avx-motion-*.txt` files in [precision/SIMD patches](../precision-simd/patches/) preserve disassembly of the motion callback:
the dirty version contains legacy `movups` while YMM registers are live; the
clean version uses 256-bit VEX moves. Both prototypes were removed from production
after measuring them against scalar rounding.

`avx-replication-final-2026-10-01.txt` records the retained kernel: separate
`vmulpd` / `vaddpd`, no legacy SSE spills, and `vzeroupper` before returning.

To rerun the final comparison against the original Go baseline:

```sh
task_before=$(mktemp -d /tmp/unicorn-before-XXXXXX)
git archive db1b7050e0b5ecd70c808728b989816e9320c468 | tar -x -C "$task_before"
(cd "$task_before" && go test -pgo=off -c -o /tmp/go-cpu-baseline ./internal/server)
GOEXPERIMENT=simd go test -pgo=cmd/go-server/default.pgo -c -o /tmp/go-cpu-latest ./internal/server
REPETITIONS=7 node benchmarking/tools/go-cpu-comparison.mjs /tmp/go-cpu-baseline /tmp/go-cpu-latest
```

The driver bundles the current Node harness before timing, pins each process to
the first permitted logical CPU, and rotates runtime order. It uses `GOGC=100`
for original Go and `800` for latest Go. Latest Go and Node must agree on contact,
event, entity and packet counts and final states within the documented numerical
tolerances. Original-Go outcomes are recorded without requiring them to match
the intentionally changed motion grid and nearest-eight rule.

For the additional pre-follow-up checkpoint column, export commit `a750604`
separately and compile its server benchmark with its own supplied PGO profile,
without `GOEXPERIMENT=simd`. Set `CHECKPOINT_EXECUTABLE` to that executable when
running the driver; it will use `GOGC=800` for this checkpoint.

To isolate the retained SIMD feature on the final executable:

```sh
BEFORE_GOGC=800 AFTER_GOGC=800 BEFORE_SIMD=scalar REPETITIONS=5 \
  node benchmarking/tools/go-cpu-paired.mjs cpu-followup-simd /tmp/go-cpu-latest /tmp/go-cpu-latest
```

For a collision-limit ablation, set `BEFORE_NEIGHBORS=unlimited`, keep both
executables and GC settings identical, and set `OUTCOME_COMPARISON=report`.
The JavaScript production simulation uses the limit, so the unlimited override
is intended for local experiments. Do not run builds, tests or compression jobs
alongside timed measurements.

## Reduced-precision follow-up

The [precision investigation](../../../../docs/experiments/2026-10-01/go-server-precision-simd-2026-10-01.md) records eight completed screening comparisons and an interrupted FMA parity check. The `precision-2026-10-01-*.patch` files are independent experiments against the uncommitted final follow-up source. They are not retained production changes.

## Persistent packed physics

The [packed physics report](../../../../docs/experiments/2026-10-01/go-server-packed-physics-2026-10-01.md) covers nine implemented geometry/body-layout screens and a longer two-core confirmation. Its `packed-physics-2026-10-01-*.patch` files each apply independently to the uncommitted optimized baseline. The `-tested` variants add randomized kernel tests; `bodies` includes a slot-lifecycle test. Audit variants instrument execution and must not be used for performance measurements.

The float32 patches intentionally alter geometry and/or arithmetic, and are not a complete client/server migration. Their temporary SIMD source assumes the amd64 experimental toolchain. The report explains unsupported-CPU and parity limitations. No prototype is enabled in production.

To reproduce the saved Go/JavaScript float32 separation comparison:

```sh
gzip -dc benchmarking/experiments/2026-10-01/packed-physics/results/2026-10-01-packed-physics-parity-cases.json.gz > /tmp/packed-physics-cases.json
node benchmarking/experiments/2026-10-01/packed-physics/packed-physics-parity.mjs /tmp/packed-physics-cases.json
```

To regenerate the cases, apply `packed-physics-2026-10-01-flat-f32-pipeline-tested.patch` in a separate copy of the starting source and run:

```sh
PACKED_CASES=/tmp/packed-physics-cases.json GOCACHE=/tmp/unicorn-precision-go-cache GOEXPERIMENT=simd \
  go test ./internal/collision/shape -run '^TestPacked' -count=1
```
