# Go server SIMD benchmark results — 2026-10-01

This records the first SIMD checkpoint. See the [follow-up comparison](go-server-cpu-comparison-2026-10-01-followup.md)
for the subsequent AVX fixes, exact float64 replication pipeline, motion-rounding
experiments, nearest-eight collision iterations, and final production configuration.
Statements about the latest prototype and disabled SIMD below describe that checkpoint.

The SIMD experiments have completed benchmark results. **The latest replication
prototype reduces CPU by 5.42% in the 32-player spread scenario, but increases
CPU by 0.80% on average across the 16 scenarios.** It does not yet meet the
requested greater-than-1% average improvement. SIMD remains experimental and is
not enabled by the normal production build.

These measurements compare SIMD work against the already optimized Go server.
The earlier approximately 2× improvement over the original server is documented
separately in [the original CPU comparison](go-server-cpu-comparison-2026-10-01.md).
Do not add the SIMD percentages to that comparison: the baselines differ.

## Latest implementation: CPU per tick

Before is commit `a750604`, built with the supplied PGO profile and without the
SIMD experiment. After is the uncommitted eight-lane replication prototype,
built with `GOEXPERIMENT=simd`, the same PGO profile, and
`GO_SERVER_SIMD=replication`. Both use `GOGC=800` and `GOMAXPROCS=1`.

Each entry is the median of **seven independent runs per variant**, each with
900 measured ticks after 120 warmup ticks, pinned to CPU 0. The run completed
**224 processes** across convoy, spread, contact-heavy and module-heavy workloads
at 4, 8, 16 and 32 players. CPU includes user and system CPU for the whole session.

**Negative change means less CPU; positive change means more CPU.**

| Players | Scenario | Before CPU ms/tick | SIMD CPU ms/tick | CPU change |
| ------- | -------- | -----------------: | ---------------: | ---------: |
| 4       | convoy   |           0.019237 |         0.019778 |     +2.81% |
| 4       | spread   |           0.056541 |         0.057061 |     +0.92% |
| 4       | contact  |           0.030460 |         0.030390 |     -0.23% |
| 4       | module   |           0.093643 |         0.094636 |     +1.06% |
| 8       | convoy   |           0.042648 |         0.043480 |     +1.95% |
| 8       | spread   |           0.101877 |         0.104070 |     +2.15% |
| 8       | contact  |           0.057152 |         0.058586 |     +2.51% |
| 8       | module   |           0.200000 |         0.201400 |     +0.70% |
| 16      | convoy   |           0.121134 |         0.123028 |     +1.56% |
| 16      | spread   |           0.253846 |         0.250920 |     -1.15% |
| 16      | contact  |           0.121429 |         0.125432 |     +3.30% |
| 16      | module   |           0.512019 |         0.523130 |     +2.17% |
| 32      | convoy   |           0.366714 |         0.370768 |     +1.11% |
| 32      | spread   |           0.716177 |         0.677331 |     -5.42% |
| 32      | contact  |           0.247891 |         0.247430 |     -0.19% |
| 32      | module   |           1.199691 |         1.194949 |     -0.40% |

The equal-scenario arithmetic mean CPU change is **+0.80%**. Summing the median
CPU times instead gives **−0.44%**, because this weighting gives more influence
to the more expensive scenarios. Neither result shows a greater-than-1%
overall improvement. These are point estimates; no confidence interval was
computed, and sub-1% differences should be treated as inconclusive.

Raw samples, executable SHA-256 hashes, GC settings, feature selections and
state differences are recorded in
[the latest result file](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-batch-loop.json.gz).

## Independent experiments

All rows below contain all 16 scenarios, with 900 measured ticks per process.
Mean CPU change gives every scenario equal weight. Aggregate change is the
ratio of the sums of the scenario medians. Each experiment has its own paired
before/after run; **the baselines are not identical across all rows**.

“Feature toggle” means the same experimental executable was run with scalar
versus that SIMD feature. Packing, caches or other prototype scaffolding can
remain on both sides, so these runs isolate the feature rather than its complete
cost relative to production. “Pre-SIMD HEAD” compares separate executables
against commit `a750604`. “Earlier optimized checkpoint” uses the earlier
contact-simplified executable. Each linked file identifies both executable
hashes and runtime settings.

| Experiment                                                                                                                                                                | Baseline                     | Runs per variant/scenario | Mean CPU change | Aggregate CPU change |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------: | --------------: | -------------------: |
| [Motion rounding with AVX cleanup](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-motion-clean.json.gz)                          | Feature toggle               |                         5 |          -0.60% |               -0.31% |
| [Four-axis polygon separation](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-separation-v1.json.gz)                             | Feature toggle               |                         5 |          -0.29% |               -1.07% |
| [Swept bounds and broad-phase masks](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-bounds-v1.json.gz)                           | Feature toggle               |                         5 |          -0.32% |               +0.27% |
| [Paired body transforms and sine/cosine](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-transforms-v1.json.gz)                   | Feature toggle               |                         5 |          +0.32% |               +0.17% |
| [Seven replication threshold masks](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-replication-v1.json.gz)                       | Feature toggle               |                         5 |          +0.52% |               +0.93% |
| [Triangle separation with cached columns](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-triangles-v1.json.gz)                   | Feature toggle               |                         5 |          -0.67% |               -0.69% |
| [Shared observer proximity batches](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-observers-v1.json.gz)                         | Feature toggle               |                         5 |          -0.18% |               -0.11% |
| [Triangle separation using existing vertex layout](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-triangles-aos.json.gz)         | Feature toggle               |                         5 |          -1.14% |               -1.51% |
| [Paired collision support/transform pipeline](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-support-pipeline.json.gz)           | Feature toggle               |                         5 |          -0.06% |               +0.21% |
| [Triangle-only source after removing other experiments](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-clean-geometry.json.gz)   | Earlier optimized checkpoint |                         7 |          -0.79% |               -1.03% |
| [Unrolled triangle separation with exact comparison handling](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-unroll.json.gz)     | Pre-SIMD HEAD                |                         7 |          -0.35% |               -0.69% |
| [Direct motion rounding SIMD method](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-direct-motion.json.gz)                       | Pre-SIMD HEAD                |                         7 |          -0.61% |               -0.26% |
| [Observer batches with fixed-array loads](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-observers-array.json.gz)                | Pre-SIMD HEAD                |                         7 |          -0.30% |               -0.47% |
| [Observer batches with scalar tail before AVX](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-observers-tail.json.gz)            | Pre-SIMD HEAD                |                         7 |          -0.42% |               -0.05% |
| [Four-lane replication with bulk rejection](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-replication-block.json.gz)            | Pre-SIMD HEAD                |                         7 |          +0.48% |               -1.18% |
| [Four-lane replication for sparse observers](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-adaptive-replication.json.gz)        | Pre-SIMD HEAD                |                         7 |          -0.54% |               -1.30% |
| [Sparse replication with lazy policy packing](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-lazy-policy.json.gz)                | Pre-SIMD HEAD                |                         7 |          +0.08% |               -0.59% |
| [Eight-lane conservative float32 replication filter](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-replication-float32.json.gz) | Pre-SIMD HEAD                |                         7 |          -0.02% |               -1.10% |
| [Eight-lane filter with separate sparse/dense loops (latest)](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-batch-loop.json.gz) | Pre-SIMD HEAD                |                         7 |          +0.80% |               -0.44% |

The initial existing-layout triangle run exceeded 1% mean improvement, but
subsequent isolated and revised triangle implementations measured 0.79% and
0.35% reductions. Those runs changed the implementation and baseline, so they
are not exact repetitions of the first result. They do not establish a retained
triangle optimization exceeding 1% against the current production baseline.

## Confirmed AVX usage problem

A separate controlled test compared SIMD motion rounding **without** versus
**with** clearing the upper AVX register bits before returning to scalar code.
It completed three paired repetitions across all 16 scenarios:

| Comparison                                   | Mean CPU change | Aggregate CPU change |
| -------------------------------------------- | --------------: | -------------------: |
| Faulty SIMD → SIMD with AVX boundary cleanup |         −17.82% |              −20.06% |

This supports the concern that the earlier SIMD implementation had a usage
problem. **It is a correction to faulty SIMD, not a 17.82% improvement over the
scalar server.** The cleaned motion SIMD feature measured only −0.60% against
its scalar mode. See
[the boundary comparison](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-avx-boundary.json.gz)
and [the scalar comparison](../../../benchmarking/experiments/2026-10-01/precision-simd/results/2026-10-01-cpu-simd-motion-clean.json.gz).

The investigation also found substantial slice-load bounds/address overhead,
and scalar floating-point spills emitted before AVX cleanup when scalar values
remained live. The latest replication kernel uses fixed-array loads and an
explicit, non-inlined AVX boundary returning an integer mask. Go documents the
purpose of this cleanup in
[ClearAVXUpperBits](https://pkg.go.dev/simd/archsimd#ClearAVXUpperBits).

## Latest filter and correctness checks

The latest prototype packs coordinates, IDs and conservative rejection radii
once per snapshot, only when a sparse observer needs them. Eight float32 lanes
reject entities that are clearly outside the unload radius. The radius includes
an outward margin for float32 error. Remaining entities go through the original
float64 distance checks and replication policy. Owned ships are retained, and
entity processing order is preserved. This changes neither transmitted
coordinates nor the exact checks that decide whether surviving entities load
or remain visible.

The filter's randomized test covers 100,000 trials with boundary values,
extreme magnitudes, NaNs, infinities and unaligned batches. It found no rejection
of an entity that the float64 calculation would retain. This is empirical
coverage rather than a formal proof for every possible float64 input.

The paired benchmark checks contact counts, events, entity counts, packet counts,
byte counts and final ship states after every before/after pair. All completed
SIMD runs passed those comparisons. Recorded maximum differences in final
position, velocity, rotation and spin were **zero**. Packet counts and byte
counts matching do not establish byte-for-byte equality of every packet; this
harness does not compare packet contents or every intermediate snapshot.

## Latest implementation: tick duration and memory

p95 and p99 are medians of per-process elapsed tick percentiles. Worst tick is
the maximum observed across the seven processes for each variant. These elapsed
timings include scheduling and GC effects and should not be interpreted as CPU
measurements. RSS is the median per-process peak resident memory, including
setup and warmup.

| Players | Scenario | p95 ms before → SIMD | p99 ms before → SIMD | Worst tick ms before → SIMD | Peak RSS MiB before → SIMD |
| ------- | -------- | -------------------: | -------------------: | --------------------------: | -------------------------: |
| 4       | convoy   |        0.039 → 0.042 |        0.066 → 0.071 |               0.271 → 0.316 |                67.9 → 69.0 |
| 4       | spread   |        0.093 → 0.096 |        0.182 → 0.191 |               0.479 → 0.456 |                67.1 → 65.8 |
| 4       | contact  |        0.040 → 0.040 |        0.051 → 0.052 |               0.170 → 0.090 |                69.4 → 66.2 |
| 4       | module   |        0.182 → 0.185 |        0.294 → 0.292 |               0.426 → 0.498 |                73.1 → 72.7 |
| 8       | convoy   |        0.092 → 0.096 |        0.324 → 0.316 |               2.384 → 0.814 |                72.9 → 73.3 |
| 8       | spread   |        0.178 → 0.191 |        0.292 → 0.322 |               0.510 → 0.621 |                73.9 → 73.9 |
| 8       | contact  |        0.073 → 0.076 |        0.087 → 0.120 |               0.195 → 0.195 |                70.3 → 70.9 |
| 8       | module   |        0.371 → 0.373 |        0.474 → 0.474 |               2.981 → 2.990 |                99.6 → 99.4 |
| 16      | convoy   |        0.398 → 0.399 |        0.814 → 0.823 |               3.240 → 3.745 |              102.2 → 101.4 |
| 16      | spread   |        0.456 → 0.459 |        0.685 → 0.715 |               4.180 → 3.686 |              101.7 → 100.5 |
| 16      | contact  |        0.178 → 0.182 |        0.203 → 0.205 |               3.029 → 2.838 |                88.7 → 91.7 |
| 16      | module   |        0.885 → 0.902 |        1.272 → 1.350 |               4.192 → 4.238 |              108.3 → 109.8 |
| 32      | convoy   |        1.049 → 1.084 |        2.742 → 2.756 |              10.556 → 7.639 |              142.7 → 143.4 |
| 32      | spread   |        1.092 → 1.060 |        1.546 → 1.555 |               5.581 → 6.595 |              164.8 → 156.3 |
| 32      | contact  |        0.323 → 0.324 |        0.456 → 0.470 |               3.096 → 3.277 |              103.9 → 103.8 |
| 32      | module   |        2.001 → 1.970 |        2.908 → 2.770 |               7.505 → 7.631 |              167.9 → 154.7 |

Allocation counts and allocated bytes per tick are also present in the raw
samples. They are effectively unchanged in the latest run: the largest absolute
median difference is approximately 0.011 allocations and 0.032 KiB per tick.

## Status and remaining work

The current workspace contains the replication prototype; geometry, observer
and motion experiments are archived in
[the experiment patches](../../../benchmarking/experiments).
The ordinary build still selects the scalar implementation. The SIMD build has
an AVX2 availability check and scalar fallback.

These are completed experimental measurements, not final performance acceptance
or a completed release validation. Further work includes measuring the effect
of retraining PGO for the new replication control flow, repeating promising
variants over longer runs, and running the final full validation suite for any
implementation retained. The latest prototype currently regresses most of the
smaller/dense workloads despite helping the 32-player spread workload.
