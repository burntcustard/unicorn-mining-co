# Solver, persistent caches and SIMD follow-up — 2026-10-01

The retained implementation reduces aggregate process CPU by **10.76% in the 900-tick suite** (five repetitions) and **11.42% in the 3,000-tick suite** (three repetitions), using two cores. This clears the 10% target in both suites. These are aggregate local results; several individual module scenarios regress as changed numerical rules change subsequent collisions. Go and TypeScript match exactly on the compared 3,000-tick outcomes.

This continues the [packed-physics investigation](go-server-packed-physics-2026-10-01.md). The retained implementation combines persistent collision data, less repeated bookkeeping, four-lane AVX2 observer checks, a converging velocity solver, and shared rotation arithmetic. Global positions, local geometry, accumulated velocities and angles remain float64.

The comparison starts from the already optimized, uncommitted server from the previous investigation, not the original Go port. Its executable SHA-256 is `1a4505e42327f79aca23ee48578e892fcc8df3e6b8371f586f5a23ac1554beb3`.

## What changed

### Reuse collision work across ticks

Each body pair now has one persistent record shared by all its fixture contacts. It carries neighbor eligibility, relative-transform motion bounds and a swept-motion bound. Neighbor selection visits unique body pairs in the same order as the old contact lists, including insertion, deletion and pooled contact reuse.

Polygon contacts remember their last separating axes in two uint8 hints. A separated contact can also retain a conservative separation budget: subsequent relative translation and rotation consume that budget, and the narrow phase runs again before it expires. Motion is bounded in both reference frames because either body can own the separating axis. Moving together through the world therefore does not consume the budget merely because global coordinates changed. Positions are never narrowed to float32.

Continuous collision detection reuses these bounds and finds the closest approach of the relative linear sweep. Remaining candidates use a priority queue keyed by impact time and original contact order. Dirty candidates are still evaluated in original order: advancing shared sweeps during evaluation makes arbitrary evaluation order unsafe. Physical TOI resolution invalidates affected candidates and the swept-motion cache.

There is also a dense contact traversal buffer with tombstones, and a separate list of touching physical contacts for island construction. Solver constraint storage is allocated lazily, keeping contacts that never touch from carrying all the constraint payload. Polygon construction uses stack scratch space for small hulls and one backing allocation for vertices and normals.

On this amd64 build, a contact header changes from 640 bytes including constraints to 344 bytes, with a separate 368-byte constraint allocation when needed. A body grows from 360 to 392 bytes, and a body-pair record is 200 bytes. Thus a touching contact can consume more total storage than before; this is an access-pattern optimization, not a claim that every object or the whole process uses less memory. These are struct sizes before allocator size classes and backing buffers. In the retained 32-player module run at 3,000 ticks, median RSS was 273.3 → 267.1 MB and allocation was 403.8 → 346.8 KB/tick. These are whole-workload measurements with changed trajectories; end-of-run heap snapshots also depend on GC timing and are not peak-memory guarantees.

### Batch useful work and reduce repeated lookups

Observer positions are packed once per movement update. With at least eight observers and AVX2 support, distance checks consume four float64 positions at once, retaining the original arithmetic and inclusive threshold. Smaller sets and unsupported CPUs use the scalar implementation. This extends the existing AVX2 replication work without adding workers.

Collision bookkeeping retains the concrete game-object pointer and marks records visited during a step, avoiding repeated interface calls and entity-map lookups. Replication membership caches are indexed by observer/view ordinal rather than by entity/observer slot. IDs and snapshot stamps validate each hit; reorder, replacement, eviction, initial load and respawn paths are covered. Snapshot cadence decisions become small reusable bit masks. Hot numeric replication comparisons use typed floats; removing the redundant field ID from each field state offsets the numeric-buffer payload.

### Stop a converged velocity solve

Both Go and TypeScript use the same stopping condition. After a complete island iteration, stop only if every normal and tangent impulse change satisfies:

```
abs(change) <= 1e-7 * (1 + abs(newImpulse))
```

The eight-iteration maximum remains, as do position correction and continuous collision detection. Contacts that have not converged still receive all eight iterations. This is an absolute-plus-relative impulse tolerance, not a universal bound on velocity error or long-term trajectory error.

A replay audit captures prepared constraints from fixed-eight-iteration sessions, then solves identical inputs with each tolerance. It separates isolated one-point contacts, isolated two-point contacts and connected islands. In the final audit, the retained threshold had maximum sampled linear-velocity deviation `5.80e-8` and angular-velocity deviation `3.61e-9`; the largest normalized deviation was `3.61e-9`, using a denominator floor of one. Difficult connected contacts in the contact workload still used 99.6% of the reference iterations. Connected module-workload islands used about 65.5%.

These are sampled one-solve errors. Small changes can alter later collision order, drilling, destruction and contact counts; the old and new long-run trajectories are deliberately not required to remain identical.

### Give both languages the same rotation arithmetic

Using the convergence rule with the old platform trigonometric functions exposed a Go/TypeScript divergence in the 8-player module workload. Repeating it with the old collision structures reproduced the divergence, ruling out the new caches as its cause. A shared rotation implementation resolved the tested mismatch.

A 256-entry float64 sine table occupies 2 KB. A short polynomial evaluates the residual angle, and a quarter-turn table offset supplies cosine. Both languages use the same coefficients and operation order. For angles in `[-64, 64]`, the residual is smaller than `2*pi/256`; the first omitted cosine term is below `3.1e-13`. A 400,001-angle scan checks component and squared-length errors below `1e-12`, and 1,209 TypeScript-generated cases check exact Go agreement around table boundaries. Outside that range, the existing platform trigonometric functions remain the fallback; the exact-arithmetic claim applies to the table path.

The earlier 1 KB float32 table also passed the short session parity suite, but introduced approximately float32-sized rotation-length error. The retained float64 table avoids those conversions and preserves the assumptions behind the conservative collision bounds much more closely. The motion grid remains `2^-24`; a coarser-grid candidate was built but not retained.

## What did not earn a place in production

The investigation implemented four-lane float64 and eight-lane float32 velocity solvers across independent one-contact islands. Inputs were packed once, all velocity iterations ran in the packed kernel, and results were written back afterward. This tests batching across contacts rather than placing one tiny polygon in a wide register. The corrected float64 kernel matched scalar results over 4,000 randomized lane cases with eight iterations, and its session checks retained the original outcomes. The float32 kernel changed outcomes and was evaluated separately.

[Disassembly of the corrected float32 kernel](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-batch32-assembly.txt) confirms 256-bit packed-float arithmetic, but also substantial vector traffic to the stack: packing eight lanes did not keep the whole constraint working set in registers. A more carefully scheduled solver remains a different experiment.

Neither established an additional whole-server gain sufficient to retain it. Only eligible independent islands fill these batches; packing, unfilled lanes, preparation, position solving and continuous collision remain outside the arithmetic kernel. The whole-server measurements include those costs. An initial float64 batch had an incorrect radius component in its cross product; its pre-fix results are invalid, and only the corrected version supports conclusions.

Other experiments included cached relative transforms, an AABB rejection shortcut, fused single-contact iteration loops, exact convergence, alternate free-motion queries, different contact traversal layouts and looser impulse tolerances. Several helped individual scenarios but lost in the combined workload. The AABB shortcut was rejected because an expanded AABB was not a sufficient substitute for the polygon contact rules. An early separation-cache version also missed invalidation during `Body.Advance`; a drilling fixture exposed it, and the retained implementation has a direct regression test.

The successful result is consequently a combination of reusable data and avoiding repeated work. It is not evidence that globally replacing float64 with float32 speeds up this server, nor that a fully graph-colored SIMD solver has been implemented.

## Measurement method

The benchmark uses convoy, spread, contact and module workloads at 4, 8, 16 and 32 players, seed 25, with 120 warmup ticks before each measurement. Both processes use `GOGC=800`, `GOMAXPROCS=2` and affinity `0,1`. Process order alternates. The metric is process user plus system CPU per tick, including GC CPU; it is not elapsed time or speedup from parallel execution. Builds, tests, profiling and compression are outside the final timed runs.

The aggregate reduction is `1 - sum(after scenario medians) / sum(before scenario medians)`. Each scenario supplies the same number of measured ticks; expensive scenarios therefore contribute more CPU. This is not a prediction of the production player/workload mixture. Per-scenario results matter, especially when changed numerical rules alter subsequent gameplay.

The host is an AMD Ryzen 7 5800X3D, Go 1.27.1, `GOEXPERIMENT=simd`, default `GOAMD64=v1`. These are local CPU measurements, not Fly.io measurements. AVX2 is runtime-gated. ARM64 compilation is checked, but ARM64 timing and cross-language execution parity were not measured.

The retained PGO is trained on separate 4,000-tick, 32-player convoy, spread, contact and module runs of the finished source. An earlier profile used the float32-table checkpoint. Refreshing that profile against the final source reduced CPU by another 1.33% in a strict, identical-outcome comparison. Training profiles are not timed evidence for the final result.

## Retained measurements

| Players | Workload | Before CPU ms/tick, 900 ticks |    After | CPU saved | Before CPU ms/tick, 3,000 ticks |    After | CPU saved |
| ------: | -------- | ----------------------------: | -------: | --------: | ------------------------------: | -------: | --------: |
|       4 | convoy   |                      0.022872 | 0.022893 |    -0.09% |                        0.046096 | 0.042539 |    +7.72% |
|       4 | spread   |                      0.064920 | 0.058768 |    +9.48% |                        0.054752 | 0.051969 |    +5.08% |
|       4 | contact  |                      0.032538 | 0.030623 |    +5.88% |                        0.032614 | 0.033041 |    -1.31% |
|       4 | module   |                      0.102839 | 0.097981 |    +4.72% |                        0.123182 | 0.180686 |   -46.68% |
|       8 | convoy   |                      0.050962 | 0.049976 |    +1.94% |                        0.103071 | 0.085527 |   +17.02% |
|       8 | spread   |                      0.108223 | 0.103890 |    +4.00% |                        0.109576 | 0.105405 |    +3.81% |
|       8 | contact  |                      0.066258 | 0.062152 |    +6.20% |                        0.057695 | 0.054014 |    +6.38% |
|       8 | module   |                      0.234763 | 0.212102 |    +9.65% |                        0.278321 | 0.284036 |    -2.05% |
|      16 | convoy   |                      0.117290 | 0.107729 |    +8.15% |                        0.199437 | 0.175670 |   +11.92% |
|      16 | spread   |                      0.220018 | 0.200159 |    +9.03% |                        0.232103 | 0.216094 |    +6.90% |
|      16 | contact  |                      0.115120 | 0.104713 |    +9.04% |                        0.113701 | 0.105949 |    +6.82% |
|      16 | module   |                      0.457286 | 0.411559 |   +10.00% |                        0.717755 | 0.619485 |   +13.69% |
|      32 | convoy   |                      0.348540 | 0.274503 |   +21.24% |                        0.359657 | 0.312710 |   +13.05% |
|      32 | spread   |                      0.656091 | 0.597581 |    +8.92% |                        0.689712 | 0.632258 |    +8.33% |
|      32 | contact  |                      0.228197 | 0.202604 |   +11.21% |                        0.228607 | 0.206774 |    +9.55% |
|      32 | module   |                      1.158570 | 1.018450 |   +12.09% |                        2.074116 | 1.695459 |   +18.26% |

The largest regression is the long 4-player module case: CPU rises 46.68%, while contact count rises from 37,672 to 123,682 and asteroid destruction events rise from 90 to 111. The new arithmetic changes the later trajectory and amount of gameplay work substantially, despite tiny errors in an individual solver step. This is not an across-the-board 10% saving for every player count or scenario.

Positive percentages mean less CPU; negative values are regressions. The aggregate is **10.76% / 11.42% saved**, not the average of the percentages above. The retained measurement comprises 256 processes and 432,000 measured session-ticks, plus warmup.

Raw data: [900 ticks](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-retained.json.gz), [3,000 ticks](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-retained-long.json.gz). The preceding [same-rules control](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-same-rules.json.gz) showed **10.90% lower CPU with strict unchanged outcomes**, before the last PGO refresh. That control retains the old structures and original profile but uses the new numerical rules: it excludes changed gameplay as the explanation for those savings, while still including profile effects.

The [retained-build parity check](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-retained-parity.json) compares every retained long-run repetition with both languages' archived outcomes, including byte totals. The measured retained executable SHA-256 is `2097c41aabb35a07637415985bc9ded9b81660f01c7427a012f167cfd333952a`.

## Alternate-seed four-player confirmation

A follow-up reran all four 4-player workloads with **world seed 26**, selected before measurement instead of the original seed 25. It uses the same archived before/after executables and hashes above, 3,000 measured ticks after 120 warmup ticks, five alternating-order repetitions, `GOGC=800`, `GOMAXPROCS=2`, and CPU affinity `0,1`. No implementation changes or concurrent builds were made. CPU includes process user plus system time. This compares the full retained patch combination, not individual patches.

| Workload | Before CPU ms/tick | After CPU ms/tick | CPU saved | Before contacts | After contacts |
| -------- | -----------------: | ----------------: | --------: | --------------: | -------------: |
| convoy   |           0.061733 |          0.057962 |     6.11% |           9,931 |          9,367 |
| spread   |           0.050110 |          0.038411 |    23.35% |           3,818 |          1,801 |
| contact  |           0.026728 |          0.025362 |     5.11% |          48,202 |         48,208 |
| module   |           0.141426 |          0.103484 |    26.83% |          67,717 |         37,508 |

Aggregate CPU falls **19.56%**, calculated from the sums of scenario medians. The module regression is absent on this seed: CPU falls 26.83%, while contacts fall from 67,717 to 37,508. Asteroid destruction changes only from 102 to 101, but collision events fall from 31,378 to 15,253. All five module measurements with the patched executable use less CPU than any of the five baseline measurements.

The opposite contact-count changes on seeds 25 and 26 support sensitivity to changed trajectories and resulting collision work. They do not isolate the rotation implementation from solver convergence, establish performance across arbitrary seeds, or turn changed-workload timing into a per-operation speedup. The original seed-25 regression remains a valid result. The smaller median savings in the contact scenario have overlapping sample ranges.

Each executable reproduces its own contacts, events, packets, bytes, entity count and compared final states exactly across all five repetitions. Old/new outcomes intentionally differ; this run does not repeat TypeScript parity validation. Raw results preserve every sample and both executable hashes: [seed-26 four-player results](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-seed26-four-player.json.gz).

Reproduce with:

```sh
SESSION_SEED=26 PLAYERS=4 BEFORE_GOGC=800 AFTER_GOGC=800 \
  GOMAXPROCS=2 CPU_AFFINITY=0,1 REPETITIONS=5 TICKS=3000 \
  OUTCOME_COMPARISON=report node benchmarking/tools/go-cpu-paired.mjs \
  solver-seed26-four-player /tmp/go-precision-before /tmp/go-solver-retained
```

## Validation and deployment

- All 16 Go/TypeScript scenarios pass at 3,000 measured ticks: compared states, contact counts, events, packet counts and byte totals match exactly. This session-summary comparison is separate from packet-by-packet validation.
- The reconnect/respawn/backpressure session test compares 385 decoded packets and passes after fixing cache invalidation in the direct initial-load encoding path.
- Full Go tests, generated TypeScript fixtures, scalar-fallback tests and ARM64 cross-compilation pass.
- Cache tests exercise 40,000 poses, 10,000 randomized continuous sweeps, pooled contact reuse, body-pair order, TOI heap invalidation/ties, contact-buffer compaction and large coordinates up to 20 million.
- Observer tests compare packed and scalar decisions at inclusive boundaries and coordinates up to one trillion. Replication tests cover numeric canonicalization and membership reorder/replacement/eviction/load.
- Production build, simulation, collisions, prediction, server, docked/lazy-chunk and packet-size checks pass. Lint reports only the two pre-existing `no-new-array` warnings.

Client and server must be released together because the convergence rule and rotation arithmetic are shared simulation behavior. Nothing has been deployed. The client entry changes from 115,157 to 120,491 bytes, or 50,909 to 52,997 gzip-level-1 bytes: **+2,088 gzipped bytes**. Docked and sound chunks are unchanged. The Node server bundle changes from 100,475 / 43,458 to 105,848 / 45,408 bytes (raw / gzip level 1). The pre-existing entry-chunk size warning remains.

## Research that informed the experiments

[Box2D's SIMD solver design](https://box2d.org/posts/2024/08/simd-matters/) groups independent contacts so lanes do not write the same body. That motivated the cross-island batch controls; the graph and data preparation matter as much as vector width. [Solver2D](https://box2d.org/posts/2024/02/solver2d/) also distinguishes iteration, substep and solver-family changes. This implementation retains the existing contact model and position solver rather than importing a different engine wholesale.

[Jolt's contact-cache settings](https://jrouwe.github.io/JoltPhysics/struct_physics_settings.html) and [architecture](https://jrouwe.github.io/JoltPhysics/) support investigating body-pair coherence before repeating narrow-phase work. Our rejection cache has its own conservative motion bounds and invalidation tests; it does not copy Jolt's numerical thresholds.

[Box2D's determinism discussion](https://box2d.org/posts/2024/08/determinism/) identifies math-library and fused-operation differences independently of thread ordering. That distinction became directly relevant when the new solver trajectory exposed platform-trig drift. [Its collision SIMD study](https://box2d.org/posts/2026/07/simd-for-collision/) also cautions against transferring large-hull kernel gains to tiny shapes without measuring the full workload.

## Reproduction artifacts

[Build, control and replay instructions](../../../benchmarking/experiments/2026-10-01/solver/README.md) describe the source patches, original and retained PGO, the corrected SIMD prototypes, and the instrumented audit. [The experiment summary](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-summary.json) preserves scenario medians and the exploratory history. Some early checkpoints are invalid or discarded; the instructions identify them explicitly. [Resource sizes](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-resources.json) and [the velocity replay output](../../../benchmarking/experiments/2026-10-01/solver/results/2026-10-01-solver-velocity-replay.txt) are archived separately.
