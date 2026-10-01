# Precision and SIMD investigation — 2026-10-01

The proposed packed-data follow-up is now investigated in [Persistent packed physics](go-server-packed-physics-2026-10-01.md), including canonical geometry replacements and body-state pages.

This investigation starts from the **uncommitted final follow-up implementation**, including its AVX2 replication pipeline, binary motion grid, collision-neighbor limit and current PGO. It does not compare against the original Go port. See [the previous follow-up](go-server-cpu-comparison-2026-10-01-followup.md) and [earlier SIMD experiments](go-server-simd-results-2026-10-01.md).

The precision restriction is relaxed: changes to old trajectories are allowed, but a production implementation must still agree with TypeScript. Changed trajectories are recorded rather than used to reject experimental measurements. None of the screened variants has yet established a production CPU improvement. Experimental gameplay changes remain in archived patches, not production source.

## What the previous work had and had not tested

- The old float32 replication filter retained float64 coordinates, packed additional float32 coordinates, used a conservative margin, then repeated exact distance/policy work for survivors. That was not a test of a wholly float32 replication distance path.
- The retained replication implementation already reuses exact AVX2 distances. Its benefit is a pipeline improvement; widening its arithmetic alone has a small remaining ceiling.
- The motion grid is 2⁻²⁴, approximately 0.0000000596 world units. It is quantization of **float64** values, not a compact storage format. Changing that constant alone does not halve memory or double SIMD lanes.
- Earlier AVX/SSE transition bugs were real and already corrected. New replication disassembly confirms eight-lane `vmulps`/`vaddps` and `vzeroupper` before return, without legacy SSE operations in the live-YMM portion.
- The existing implementation uses pointers, interfaces, separate bodies and variable-sized collision work. It does not keep the whole simulation in persistent arrays of positions, velocities and rotations. Repacking these objects for a tiny SIMD operation can cost as much as the arithmetic it replaces.

## New screening measurements

| Experiment                                                                                                          | Mean CPU change | Aggregate CPU change | Comparison                                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------: | -------------------: | ------------------------------------------------------ |
| [GOAMD64=v2](../../benchmarking/results/2026-10-01-cpu-precision-v2.json.gz)                                           |          -0.18% |               +0.03% | Current production rules; strict outcomes match        |
| [GOAMD64=v3, fusion disabled](../../benchmarking/results/2026-10-01-cpu-precision-v3-nofma.json.gz)                    |          -0.84% |               +0.02% | Current production rules; strict outcomes match        |
| [Float32 final motion rounding](../../benchmarking/results/2026-10-01-cpu-precision-motion-f32.json.gz)                |          +0.02% |               +0.19% | Changed simulation; no client port retained            |
| [Float32 AVX replication distances](../../benchmarking/results/2026-10-01-cpu-precision-replication-f32.json.gz)       |          -0.15% |               -0.02% | Same final physics states; packet bytes differ         |
| [Short scalar sine/cosine polynomial](../../benchmarking/results/2026-10-01-cpu-precision-trig.json.gz)                |          +0.29% |               +2.27% | Changed simulation                                     |
| [128-bit packed polynomial, local constants](../../benchmarking/results/2026-10-01-cpu-precision-trig-sse.json.gz)     |          +2.61% |               +4.03% | Changed simulation                                     |
| [128-bit packed polynomial, shared constants](../../benchmarking/results/2026-10-01-cpu-precision-trig-packed.json.gz) |          +1.20% |               -0.00% | Compared with scalar polynomial; strict outcomes match |
| [GOMAXPROCS 1 → 2, affinity 0,1](../../benchmarking/results/2026-10-01-cpu-precision-two-cores.json.gz)                |          +5.11% |               -0.46% | Identical executable; strict outcomes match            |

Negative CPU change is better. The mean weights each scenario equally; aggregate is the ratio of sums of scenario median CPU times. These are screening point estimates, not confidence intervals. Near-zero differences are inconclusive, and the three-run screen is not sufficient evidence to retain a small gain.

Complete runs cover convoy, spread, contact and module workloads at 4, 8, 16 and 32 players, with three repetitions per executable/scenario and 900 measured ticks after 120 warmup ticks. Both sides use GOGC=800, the same PGO, and enabled production SIMD. There are 768 completed measured processes, plus 20 samples in the interrupted v3 run. Before/after process order alternates. Measurements are process user+system CPU, not elapsed tick time. Builds and tests were kept outside the timed measurements.

The shared-constant packed-polynomial row compares against the new scalar polynomial, isolating vectorization from changed trajectories. It removes coefficient construction on the stack; disassembly confirms direct constant loads. It does not establish a production win.

The initial v3 run used 3000 ticks and strict outcome comparison. It stopped at 4-player module: 37,672 contacts versus 57,033. This is not a completed performance comparison. Disabling FMA fusion restored strict benchmark outcome agreement across all 16 scenarios. The debug flag `-gcflags=all=-d=fmahash=n` is an investigation tool, not a proposed production configuration.

The two-core run gives both variants affinity to CPUs 0 and 1, and compares GOMAXPROCS=1 with GOMAXPROCS=2 using the same executable. It adds no simulation concurrency. This local Ryzen test is not a measurement of Fly throttling, CPU credits, or its physical host.

## Precision and representation findings

| Data                                    | Current representation                   | Assessment                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| World positions                         | Two float64 values                       | Keep until an absolute error/range budget is defined; global float32 loses resolution with distance from the origin.                                                                                         |
| Shape-local vertices and normals        | float64                                  | Stronger candidate for float32 storage: bounded coordinates, reusable data, potentially more values per cache line and SIMD load. Requires measuring a persistent packed layout, not converting every query. |
| Rotation angle and cached sine/cosine   | float64                                  | Approximation is possible, but cached rotation components must remain sufficiently close to a unit rotation; cheaper trig alone did not improve the screened full sessions.                                  |
| Velocity, spin and solver intermediates | float64                                  | A float32 implementation needs explicit matching rounding points in TypeScript. Rounding only the final state is a different experiment.                                                                     |
| Entity IDs and flags                    | int64 / machine-sized int in replication | Exact integers should not become floats. Narrowing flags is plausible; narrowing IDs needs a proven range or an index/ID mapping.                                                                            |

Float32 spacing is 0.0001220703125 at position 2,000; 0.001953125 at 20,000; 0.0625 at 1,000,000; and 1 at 10,000,000. A small relative error in a large world coordinate can therefore exceed a useful absolute collision error. Current linear slop is 0.5 and region size is 2,000. Region-relative float32 coordinates are a possible design, but crossing regions and relative transforms would become part of the shared simulation contract.

The motion experiment replaces `RoundMotion` with `float64(float32(value))`. TypeScript could match that operation with `Math.fround`. It does **not** convert all body storage or intermediate arithmetic to float32, so its near-zero result does not rule out a full packed float32 simulation.

The replication experiment replaces the packed X/Y arrays and reused distance block with float32, computes eight distances per AVX vector, and uses those distances directly for subsequent policy. It preserves full-width IDs. Physics remains unchanged; recorded packet bytes change in two contact scenarios. It is not validated for arbitrary world magnitudes or exact boundary behavior and is not installed in production.

The trig experiments change only vector transforms and cached collision sweeps. They reduce to [-π/4, π/4], evaluate degree-7 sine and degree-8 cosine polynomials, and use standard trig outside [-32,32]. A 200,001-point scan found maximum component error approximately 3.12e-7 and squared-length error 4.07e-7. This sampled accuracy is not a proof for all inputs. A 128-bit packed version evaluates sine/cosine together; the compiler emits VEX-encoded XMM operations, despite the experiment's “sse” filename. Changed collision paths affect the amount of downstream work; the old/new CPU deltas cannot isolate polynomial instruction cost.

## Where a larger SIMD gain could come from

The existing module training profile attributes 0.58% inclusive CPU to `replicationBlock`, 2.91% to `math.Sincos`, and 74.23% to the full game collision step. These figures describe that profile, not every workload. Even eliminating the replication arithmetic entirely would have a small ceiling there. The collision step includes traversal, contact management and branching as well as arithmetic; it is not all directly vectorizable.

The next substantial experiment should change the **persistent physics data layout**: contiguous batches of local geometry or body state, with conversions at simulation boundaries, and several operations performed before returning to object code. Float32 can then reduce both traffic and arithmetic width. This is a larger shared-simulation change, not another intrinsic substituted into an existing two-coordinate helper. Contact solver dependencies and early exits must be preserved or explicitly redesigned on both sides.

Client/server agreement needs two separate checks: error against the old numerical rules, and agreement between the new Go and new TypeScript rules. Go float32 operations generally need matching `Math.fround` stages in JavaScript; `Math.fround` once at the end is not equivalent. Likewise, Go's v3 FMA fusion rounds once where ordinary JavaScript multiply-plus-add rounds twice. The [Go specification](https://go.dev/ref/spec#Floating_point_operators) permits fusion and documents explicit floating-point conversions to prevent it. The [Go CPU requirements](https://go.dev/wiki/MinimumRequirements) identify v2 and v3 instruction sets. No Fly-wide ISA support assumption is made here.

## Artifacts and reproduction

The [paired driver](../../benchmarking/go-cpu-paired.mjs) now accepts `CPU_AFFINITY`, `GOMAXPROCS`, `BEFORE_GOMAXPROCS` and `AFTER_GOMAXPROCS`, and records the selected values. Existing defaults remain one CPU and GOMAXPROCS=1. Raw results record executable hashes and outcomes.

The patches named `precision-2026-10-01-*.patch` in [experiments](../../benchmarking/experiments) apply independently to the starting working-tree implementation, not to HEAD. For replication, the existing exact-float64 kernel test must be excluded when compiling the prototype because its data representation and contract have changed; that exclusion is not a correctness validation. Production tests are preserved.

```sh
GOCACHE=/tmp/unicorn-precision-go-cache GOEXPERIMENT=simd \
  go test -pgo=cmd/go-server/default.pgo -c -o /tmp/go-precision-before ./internal/server
# Repeat with GOAMD64=v2 or v3 for architecture experiments.
BEFORE_GOGC=800 AFTER_GOGC=800 REPETITIONS=3 TICKS=900 \
  node benchmarking/go-cpu-paired.mjs cpu-precision-recheck /tmp/go-precision-before /tmp/go-precision-candidate
# Use OUTCOME_COMPARISON=report for intentionally changed numerical rules.
CPU_AFFINITY=0,1 BEFORE_GOMAXPROCS=1 AFTER_GOMAXPROCS=2 \
  BEFORE_GOGC=800 AFTER_GOGC=800 REPETITIONS=3 TICKS=900 \
  node benchmarking/go-cpu-paired.mjs cpu-precision-two-core-recheck /tmp/go-precision-before /tmp/go-precision-before
```

Validation: production builds before and after passed and emitted identical client chunk names and sizes; lint passed with the same two existing `unicorn(no-new-array)` warnings; the paired driver passed JavaScript syntax checking; the production AVX2 exactness test passed. Strict full-session comparisons passed for both architecture controls, the scalar/packed polynomial comparison, and the two-core run. Experimental changed-rule variants have not been ported to TypeScript or passed cross-language parity; no such variant is being promoted.

Resources are unchanged: client entry 115,157 bytes / 50,909 gzip-level-1 bytes; docked chunk 4,708 / 2,431; sound chunk 1,681 / 942; Node server 100,475 / 43,458. No production Go source or PGO changed in this investigation. The baseline benchmark executable SHA-256 is `1a4505e42327f79aca23ee48578e892fcc8df3e6b8371f586f5a23ac1554beb3`, identical to the previous follow-up's final executable. The [summary](../../benchmarking/results/2026-10-01-precision-summary.json) includes per-scenario medians and changed outcome fields.
