# Go server CPU comparison after SIMD and collision experiments — 2026-10-01

The latest [persistent packed physics investigation](go-server-packed-physics-2026-10-01.md) records primary-source research, nine implemented layout comparisons, kernel parity tests, and a longer two-core confirmation.

The subsequent [precision and SIMD investigation](go-server-precision-simd-2026-10-01.md) tests reduced precision, CPU instruction targets, and two-core CPU accounting against this final implementation.

Latest Go uses **51.83% less total CPU than original Go**, and **80.43% less than current Node.js**, summing the scenario medians. The equal-scenario average speedups are **2.130× over original Go** and **7.360× over Node.js**. Relative to the optimized Go checkpoint before this follow-up, the aggregate CPU change is **-4.14%**.

These are fresh local measurements of whole-session user plus system CPU. They include simulation, collisions, modules, region synchronization, replication, binary encoding and acknowledgements. They do not measure network latency or production CPU quotas.

## CPU per tick

Every cell is the median of **seven independent process runs**, each with 900 measured ticks after 120 warmup ticks. All four implementations ran sequentially in rotating order on CPU 0: **448 measured processes**. Both ratios use the same latest-Go samples. Lower CPU and higher speedup are better.

| Players | Scenario | Original Go CPU ms/tick | Latest Go CPU ms/tick | Current Node CPU ms/tick | Original Go / latest Go | Node / latest Go |
| ------- | -------- | ----------------------: | --------------------: | -----------------------: | ----------------------: | ---------------: |
| 4       | convoy   |                0.049253 |              0.018763 |                 0.229077 |               **2.62×** |       **12.21×** |
| 4       | spread   |                0.117058 |              0.053540 |                 0.519718 |               **2.19×** |        **9.71×** |
| 4       | contact  |                0.065734 |              0.028592 |                 0.336180 |               **2.30×** |       **11.76×** |
| 4       | module   |                0.191333 |              0.091134 |                 0.778773 |               **2.10×** |        **8.55×** |
| 8       | convoy   |                0.099179 |              0.041257 |                 0.470696 |               **2.40×** |       **11.41×** |
| 8       | spread   |                0.215114 |              0.094692 |                 0.695891 |               **2.27×** |        **7.35×** |
| 8       | contact  |                0.118892 |              0.054522 |                 0.538720 |               **2.18×** |        **9.88×** |
| 8       | module   |                0.390929 |              0.246401 |                 1.515770 |               **1.59×** |        **6.15×** |
| 16      | convoy   |                0.236928 |              0.119678 |                 0.842837 |               **1.98×** |        **7.04×** |
| 16      | spread   |                0.468909 |              0.238192 |                 1.082619 |               **1.97×** |        **4.55×** |
| 16      | contact  |                0.244208 |              0.114614 |                 0.798533 |               **2.13×** |        **6.97×** |
| 16      | module   |                0.996094 |              0.456726 |                 2.018051 |               **2.18×** |        **4.42×** |
| 32      | convoy   |                0.643146 |              0.350438 |                 1.471713 |               **1.84×** |        **4.20×** |
| 32      | spread   |                1.410077 |              0.664342 |                 2.632654 |               **2.12×** |        **3.96×** |
| 32      | contact  |                0.488752 |              0.238646 |                 1.242956 |               **2.05×** |        **5.21×** |
| 32      | module   |                2.483899 |              1.147944 |                 5.059799 |               **2.16×** |        **4.41×** |

The three ways of combining results answer different questions; percentages and speedups from separate experiments should not be added.

| Reference                   | Arithmetic mean of scenario speedups | Geometric mean | Sum of reference CPU / sum of latest CPU | Aggregate CPU reduction |
| --------------------------- | -----------------------------------: | -------------: | ---------------------------------------: | ----------------------: |
| Original Go                 |                               2.130× |         2.118× |                                   2.076× |                  51.83% |
| Pre-follow-up Go checkpoint |                               1.035× |         1.033× |                                   1.043× |                   4.14% |
| Current Node.js             |                               7.360× |         6.838× |                                   5.110× |                  80.43% |

Original-to-latest individual speedups range from **1.59× to 2.62×**. This is an average improvement, not a claim that every workload exceeds 2×. Point estimates below 1% are inconclusive; no confidence interval was computed.

## Incremental change in this follow-up

This checkpoint is commit `a750604`, already containing the earlier approximately 2× optimization pass. It uses its own original PGO profile, `GOGC=800`, and a scalar build. Latest Go uses the changes documented below and a fresh profile. This table isolates the new work from the cumulative original-to-latest comparison, while including intentional shared-rule changes.

| Players | Scenario | Pre-follow-up Go CPU ms/tick | Latest Go CPU ms/tick | CPU change |
| ------- | -------- | ---------------------------: | --------------------: | ---------: |
| 4       | convoy   |                     0.019104 |              0.018763 |     -1.79% |
| 4       | spread   |                     0.056802 |              0.053540 |     -5.74% |
| 4       | contact  |                     0.029954 |              0.028592 |     -4.55% |
| 4       | module   |                     0.095767 |              0.091134 |     -4.84% |
| 8       | convoy   |                     0.042241 |              0.041257 |     -2.33% |
| 8       | spread   |                     0.101078 |              0.094692 |     -6.32% |
| 8       | contact  |                     0.056794 |              0.054522 |     -4.00% |
| 8       | module   |                     0.202627 |              0.246401 |    +21.60% |
| 16      | convoy   |                     0.120580 |              0.119678 |     -0.75% |
| 16      | spread   |                     0.248479 |              0.238192 |     -4.14% |
| 16      | contact  |                     0.120896 |              0.114614 |     -5.20% |
| 16      | module   |                     0.501336 |              0.456726 |     -8.90% |
| 32      | convoy   |                     0.368886 |              0.350438 |     -5.00% |
| 32      | spread   |                     0.718910 |              0.664342 |     -7.59% |
| 32      | contact  |                     0.248150 |              0.238646 |     -3.83% |
| 32      | module   |                     1.198832 |              1.147944 |     -4.24% |

Giving scenarios equal weight produces a **-2.98% mean CPU change**. Summing their median CPU times produces **-4.14%**.

The 8-player module case regresses by **21.60%** versus the checkpoint while
performing more scripted drilling/contact work: **28,516 contacts and 159 ending
entities**, versus **23,873 and 144**. Current Go and Node agree on those outcomes.
The changed workload is included in these averages and in the outcome table below.

## Tick duration

p95 and p99 are medians of per-run elapsed tick percentiles. Worst is the single largest tick over all seven runs, and can include scheduling or GC delays. These values describe tick processing, not end-to-end latency.

| Players | Scenario | Original Go p95 / p99 ms | Latest Go p95 / p99 ms | Node p95 / p99 ms | Original Go worst ms | Latest Go worst ms | Node worst ms |
| ------- | -------- | -----------------------: | ---------------------: | ----------------: | -------------------: | -----------------: | ------------: |
| 4       | convoy   |            0.111 / 0.253 |          0.037 / 0.065 |     0.859 / 3.355 |                1.616 |              0.127 |        12.832 |
| 4       | spread   |            0.234 / 0.455 |          0.088 / 0.134 |     2.963 / 7.893 |                1.926 |              0.521 |        18.360 |
| 4       | contact  |            0.129 / 0.172 |          0.036 / 0.045 |     1.168 / 6.100 |                1.330 |              0.117 |        14.721 |
| 4       | module   |            0.397 / 0.743 |          0.181 / 0.295 |     3.241 / 7.225 |                2.169 |              2.742 |        19.114 |
| 8       | convoy   |            0.215 / 0.629 |          0.088 / 0.302 |     2.970 / 6.761 |                1.557 |              3.078 |        20.747 |
| 8       | spread   |            0.413 / 0.758 |          0.165 / 0.255 |     3.184 / 6.613 |                1.836 |              0.489 |        24.505 |
| 8       | contact  |            0.216 / 0.323 |          0.069 / 0.084 |     3.015 / 7.249 |                2.328 |              0.144 |        17.333 |
| 8       | module   |            0.808 / 1.755 |          0.460 / 0.719 |     4.635 / 8.864 |                2.754 |              3.304 |        20.634 |
| 16      | convoy   |            0.681 / 1.356 |          0.397 / 0.788 |     3.738 / 8.755 |                2.875 |              2.354 |        22.131 |
| 16      | spread   |            0.800 / 2.086 |          0.432 / 0.670 |     3.668 / 6.658 |                4.071 |              3.332 |        14.483 |
| 16      | contact  |            0.448 / 1.181 |          0.160 / 0.185 |     3.269 / 6.152 |                1.931 |              0.333 |        15.918 |
| 16      | module   |            2.145 / 3.203 |          0.741 / 0.980 |     4.707 / 7.787 |                6.061 |              3.831 |        14.789 |
| 32      | convoy   |            1.774 / 3.105 |          0.951 / 2.459 |     5.162 / 8.365 |                5.856 |              8.141 |        19.413 |
| 32      | spread   |            2.850 / 5.889 |          1.137 / 1.593 |     6.280 / 9.332 |               10.303 |              5.379 |        21.325 |
| 32      | contact  |            0.878 / 1.147 |          0.305 / 0.440 |     3.741 / 6.421 |                2.578 |              3.067 |        14.846 |
| 32      | module   |            5.087 / 8.082 |          1.864 / 2.751 |    9.984 / 14.329 |               15.198 |              7.778 |        50.022 |

## Allocations and memory

Go allocation counts and bytes are per measured tick. RSS is the median process peak including setup and warmup. Node allocation counts are not collected. Higher Go RSS includes retained caches and the existing `GOGC=800` tradeoff.

| Players | Scenario | Go allocations/tick original → latest | Go allocated KiB/tick original → latest | Original Go RSS MiB | Latest Go RSS MiB | Node RSS MiB |
| ------- | -------- | ------------------------------------: | --------------------------------------: | ------------------: | ----------------: | -----------: |
| 4       | convoy   |                          421.9 → 58.5 |                             18.7 → 10.3 |                31.4 |              71.0 |        187.3 |
| 4       | spread   |                         593.0 → 145.7 |                             35.3 → 17.3 |                33.9 |              70.9 |        197.9 |
| 4       | contact  |                         440.6 → 106.5 |                              25.7 → 9.2 |                31.3 |              71.5 |        194.9 |
| 4       | module   |                        1143.3 → 331.2 |                             66.1 → 27.6 |                35.4 |              71.8 |        195.4 |
| 8       | convoy   |                         884.0 → 123.1 |                             47.3 → 28.9 |                35.8 |              72.6 |        194.1 |
| 8       | spread   |                        1026.8 → 233.5 |                             59.5 → 30.0 |                38.6 |              71.9 |        196.2 |
| 8       | contact  |                         869.3 → 203.4 |                             52.2 → 18.7 |                33.5 |              70.4 |        194.5 |
| 8       | module   |                        2342.3 → 706.7 |                            140.2 → 62.4 |                38.3 |             103.9 |        217.8 |
| 16      | convoy   |                        1959.9 → 286.4 |                            124.6 → 79.4 |                39.5 |             102.0 |        195.1 |
| 16      | spread   |                        2113.1 → 479.5 |                            130.7 → 64.1 |                40.4 |             103.8 |        209.4 |
| 16      | contact  |                        1781.7 → 394.9 |                            110.8 → 37.9 |                36.6 |              86.9 |        195.7 |
| 16      | module   |                       5062.2 → 1331.6 |                           321.0 → 123.2 |                44.3 |             104.2 |        220.5 |
| 32      | convoy   |                        4584.3 → 752.2 |                           329.9 → 199.9 |                46.7 |             136.7 |        204.7 |
| 32      | spread   |                       4997.2 → 1079.4 |                           335.9 → 164.1 |                54.8 |             171.2 |        230.8 |
| 32      | contact  |                        3579.5 → 707.8 |                            217.5 → 64.1 |                43.7 |             104.4 |        201.4 |
| 32      | module   |                      10714.4 → 3047.5 |                           761.7 → 327.0 |                56.1 |             173.5 |        287.8 |

The separate 6,000-tick, 32-player profile-training runs reached a largest process peak of **492.9 MiB**. These longer runs include continued drilling and entity growth; their timings are not mixed into the 900-tick table.

## Retained changes

### AVX boundaries and replication

The earlier motion prototype left upper AVX bits live before scalar code. Clearing them reduced CPU by 17.82% on the equal-scenario average against that faulty prototype. A later native-rounding prototype still contained compiler-generated legacy `movups` spills inside its 256-bit callback: disassembly identified the problem, and an all-256-bit version removed those spills. Its final gain versus scalar was only 0.28%, so motion SIMD was removed. [Go’s AVX cleanup documentation](https://pkg.go.dev/simd/archsimd#ClearAVXUpperBits) describes why boundaries matter.

The retained replication pipeline processes **16 entities per call using four float64 AVX2 vectors**, preserves separate multiplication and addition, and clears upper bits before returning an integer mask. It batches distance calculation, radius checks, station-marker exceptions and owned-ship inclusion; the exact distances are stored once and reused for membership and cadence. Sparse observers use this path; dense observers and incomplete tails use scalar code. Packing IDs happens at most once per snapshot when needed. The conservative float32 conversion/guard prototype was replaced with this simpler exact float64 path.

The distance-only kernel measured **2.93× faster for 2,048 entities**: median 2,214 ns scalar versus 755.6 ns AVX2, with zero allocations on both sides. That kernel ratio is not a whole-server ratio. [Kernel samples](../../benchmarking/results/2026-10-01-followup-distance-kernel.txt) contain three repetitions. SIMD exactness tests cover 100,000 unaligned batches, threshold-adjacent values, owned entities, station flags, NaN and infinity. Scalar tails and snapshot ordering are preserved. Production builds now set `GOEXPERIMENT=simd`; runtime AVX2 detection and build tags retain scalar fallbacks. [Go’s SIMD experiment](https://go.dev/blog/simd-experiment) is the compiler/library mechanism used here.

### Go-native motion rounding

Motion now uses `math.RoundToEven(value * 2^24) * 2^-24`, with the same rule implemented on the JavaScript client and Node server. Power-of-two scaling avoids decimal division and lets Go use native ties-to-even rounding. The maximum single-field quantization error is **2^-25 ≈ 2.98e-8**. Procedural geometry keeps its existing eight-decimal seeded rule. `RoundInteger` has been replaced by the descriptive `RoundTiesUp` for the remaining whole-number, ties-toward-positive-infinity calls.

Removing all motion rounding, keeping only final rounding, or omitting velocity rounding changed long contact/drilling trajectories and did not establish a clean CPU win. Those variants were rejected. The retained binary-grid change measured −0.30% mean / +0.55% aggregate CPU change against the decimal grid; it stays because the Go implementation is simpler and the measured difference is below 1%. Rounding still runs at the existing simulation stages.

### Nearest-eight collision GameObjects

Both shared JavaScript and Go gameplay simulations select the **eight closest potential neighboring GameObjects** when a body has more than eight broad-phase neighbors. Multiple fixtures belonging to the same body count once. Each pair must be selected by both endpoints. Selection is recomputed for the discrete and continuous collision passes; this bounds neighbors per pass, rather than asserting eight unique contacts across an entire moving update. Equal-distance ties keep the original first-index order.

The final version reuses active-body buffers, lazily allocates eight-entry neighborhoods only for crowded bodies, and maintains a conservative neighbor-count threshold during existing contact bookkeeping. Ordinary bodies with at most eight potential neighbors avoid ranking. Deferred contacts remain cached and are reconsidered; items, asteroids, stations and ships all retain their physics and collision participation. Tests verify ninth-neighbor recovery, multiple-fixture counting, equal-distance order, and existing item/asteroid momentum and damage.

Five variants were measured independently. The final sustained 3,000-tick comparison reduced summed CPU by **2.11%**, with a **0.65% equal-scenario mean reduction**. The deliberately dense collision stress test improved by **12.1% / 41.8% / 40.1%** for 16 / 32 / 64 objects. These are collision-step timings in artificial overlapping crowds, not ordinary whole-session CPU ratios. [Stress samples](../../benchmarking/results/2026-10-01-nearest-eight-stress-v5.txt) preserve the repetitions.

### Profile-guided compilation

The final PGO profile combines convoy, spread, contact and module workloads with 32 players, 6,000 measured ticks each, and seed 31. Timed comparisons use seed 25. The independent comparison keeps final source and settings identical while replacing the old supplied profile. [Training measurements](../../benchmarking/results/2026-10-01-cpu-followup-training.json) and [CPU profiles](../../benchmarking/results/go-cpu-profiles) are retained.

The merged training profile contains 35.42 seconds of CPU samples. Collision
processing accounts for 64.43% cumulatively, including the continuous solver
at 19.45%. Replication's per-player callback accounts for 15.50%. These are
overlapping call-tree percentages, not additive stage totals. Further CPU work
could target cached collision-candidate traversal or batch geometry across
independent contacts while retaining solver order. GC marking accounts for
roughly 0.6% in this profile, so another GC increase has little potential here.

## Independent experiment results

Negative changes mean less CPU. Mean is the average of per-scenario current/previous CPU ratios minus one; aggregate is the ratio of summed scenario medians minus one. Every row covers all 16 scenarios. Rows use different intermediate baselines and cannot be summed. Shared-rule experiments record changed outcomes rather than claiming bit-identical old/new trajectories.

| Experiment                                                                                                          | Runs / ticks per variant and case | Mean CPU change | Aggregate CPU change | Decision                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------: | --------------: | -------------------: | ------------------------------ |
| [First profile refresh on SIMD prototype](../../benchmarking/results/2026-10-01-cpu-avx-pgo.json.gz)                   |                           3 / 900 |          -3.69% |               -1.83% | Keep profile approach          |
| [Earlier eight-lane replication, scalar toggle](../../benchmarking/results/2026-10-01-cpu-avx-ablation.json.gz)        |                           5 / 900 |          -0.83% |               -1.61% | Superseded by exact float64    |
| [Float32 filter → exact float64 pipeline](../../benchmarking/results/2026-10-01-cpu-avx-sixteen.json.gz)               |                           5 / 900 |          -0.56% |               +0.01% | Keep simpler, exact path       |
| [Omit velocity rounding](../../benchmarking/results/2026-10-01-cpu-motion-pose.json.gz)                                |                           3 / 900 |          +2.23% |               +1.73% | Reject changed trajectories    |
| [Round only after collisions](../../benchmarking/results/2026-10-01-cpu-motion-once.json.gz)                           |                           3 / 900 |          +0.30% |               -2.74% | Reject changed trajectories    |
| [Remove all motion rounding](../../benchmarking/results/2026-10-01-cpu-motion-none.json.gz)                            |                           3 / 900 |          +2.24% |               +3.03% | Reject CPU and trajectories    |
| [Skip final rounding for inactive bodies](../../benchmarking/results/2026-10-01-cpu-motion-inactive-corrected.json.gz) |                           5 / 900 |          +0.77% |               +0.78% | Reject slower / extra branch   |
| [Gather then batch decimal rounding](../../benchmarking/results/2026-10-01-cpu-motion-batch.json.gz)                   |                           5 / 900 |          -0.43% |               -0.18% | Reject <1% / more code         |
| [Decimal motion grid → binary ties-even](../../benchmarking/results/2026-10-01-cpu-native-motion-grid.json.gz)         |                           5 / 900 |          -0.30% |               +0.55% | Keep simpler Go rule           |
| [Native SIMD motion with legacy spills](../../benchmarking/results/2026-10-01-cpu-native-vector-motion.json.gz)        |                           5 / 900 |         +11.95% |               +9.49% | Reject faulty AVX usage        |
| [Native SIMD motion after fixing spills](../../benchmarking/results/2026-10-01-cpu-native-vector-motion-clean.json.gz) |                           7 / 900 |          -0.28% |               -0.42% | Reject <1% / more code         |
| [Rank swept-bound candidates](../../benchmarking/results/2026-10-01-cpu-nearest-eight-v1.json.gz)                      |                           3 / 900 |          +4.58% |               +1.99% | Reject normal-case overhead    |
| [Filter contact creation and prune cache](../../benchmarking/results/2026-10-01-cpu-nearest-eight-v2.json.gz)          |                           3 / 900 |          +0.56% |               +0.22% | Reject overhead / complexity   |
| [Rank existing contact graph](../../benchmarking/results/2026-10-01-cpu-nearest-eight-v3.json.gz)                      |                           3 / 900 |          +3.15% |               +2.47% | Reject normal-case overhead    |
| [Active bodies and dirty counts](../../benchmarking/results/2026-10-01-cpu-nearest-eight-v4.json.gz)                   |                           3 / 900 |          -0.93% |               -0.81% | Superseded by cached threshold |
| [Cached threshold and retained deferred contacts](../../benchmarking/results/2026-10-01-cpu-nearest-eight-v5.json.gz)  |                          3 / 3000 |          -0.65% |               -2.11% | Keep total CPU / crowd gain    |
| [Final source, old PGO → fresh PGO](../../benchmarking/results/2026-10-01-cpu-followup-pgo.json.gz)                    |                           3 / 900 |          -2.25% |               -1.14% | Keep                           |
| [Final executable, scalar → retained SIMD](../../benchmarking/results/2026-10-01-cpu-followup-simd.json.gz)            |                           5 / 900 |          -0.74% |               -1.66% | Keep replication pipeline      |

The earlier [SIMD checkpoint](go-server-simd-results-2026-10-01.md) documents polygon support, separation, transforms, observer batches and broad-phase experiments. The [experiment index](../../benchmarking/results/2026-10-01-cpu-followup-experiments.json) and [archived implementations](../../benchmarking/experiments/README.md) preserve the evidence, including unsuccessful work.

## Gameplay work, packets and parity

The original Go binary has its original motion and unlimited-neighbor rules. Tiny rounding differences can change the later path of scripted drilling, and the authorized nearest-eight cap can defer crowded contacts. Therefore original/checkpoint-to-latest measurements compare resulting server behavior, not perfectly identical amounts of gameplay work. Current Go and current Node execute the same new rules and passed strict count/state comparisons on every measured run.

| Players | Scenario | Original → latest contacts/run | Original → latest entities at end | Original → latest packet KiB/run | Packet byte change |
| ------- | -------- | -----------------------------: | --------------------------------: | -------------------------------: | -----------------: |
| 4       | convoy   |                          0 → 0 |                           64 → 64 |                    283.0 → 283.0 |             +0.00% |
| 4       | spread   |                     1291 → 664 |                         173 → 167 |                    393.5 → 368.9 |             -6.26% |
| 4       | contact  |                  14958 → 14486 |                           29 → 27 |                    487.2 → 483.7 |             -0.72% |
| 4       | module   |                  10583 → 11908 |                          106 → 84 |                  3752.6 → 3877.1 |             +3.32% |
| 8       | convoy   |                      640 → 640 |                           75 → 75 |                  1045.9 → 1045.9 |             +0.00% |
| 8       | spread   |                    2435 → 1807 |                         248 → 242 |                    664.9 → 640.3 |             -3.70% |
| 8       | contact  |                  29916 → 28972 |                           39 → 36 |                  1804.0 → 1797.4 |             -0.37% |
| 8       | module   |                  23873 → 28516 |                         144 → 159 |                13795.6 → 13275.4 |             -3.77% |
| 16      | convoy   |                    3195 → 3200 |                           93 → 93 |                  4407.4 → 4407.4 |             +0.00% |
| 16      | spread   |                  24309 → 23698 |                         395 → 389 |                  1233.2 → 1208.5 |             -2.00% |
| 16      | contact  |                  59832 → 57944 |                           49 → 47 |                  6271.4 → 6280.9 |             +0.15% |
| 16      | module   |                  53435 → 52015 |                         345 → 340 |                33300.3 → 34714.4 |             +4.25% |
| 32      | convoy   |                  14537 → 14284 |                         154 → 155 |                16802.4 → 16675.2 |             -0.76% |
| 32      | spread   |                  99432 → 98846 |                         830 → 885 |                  2501.6 → 2495.2 |             -0.26% |
| 32      | contact  |                119664 → 115888 |                           67 → 65 |                15487.7 → 15583.3 |             +0.62% |
| 32      | module   |                147585 → 130229 |                         732 → 733 |                76375.4 → 76622.3 |             +0.32% |

The largest packet-byte increase versus original Go is **4.25%**, well below doubling. Motion remains fixed-width float64 on the wire; fewer decimal digits do not directly reduce that width. Differences in total bytes also reflect changed fields, interest membership and gameplay events. Binary protocol versions and field identifiers are unchanged.

The separate traced [Go/Node parity run](../../benchmarking/results/2026-10-01-followup-parity.json) checked **108,000 decoded snapshots across all 16 scenarios**, with a maximum numeric difference of **5.96e-08**. The existing numeric tolerances remain `2e-8` through 16 players and `1e-6` at 32 players. Ordered consequential collision events use the existing residual-impact threshold (`0.025` only for 32-player module; `2e-8` otherwise). Near-zero notifications are retained in the raw metrics. The timed four-way run also checked current-Go/Node contact, event, entity and packet counts and final ship states; maximum difference was `0`.

## Configuration, validation and reproduction

- Host: AMD Ryzen 7 5800X3D 8-Core Processor; pinned CPU 0, `GOMAXPROCS=1` for Go.
- Runtimes: `go version go1.27.1 linux/amd64`, Node `v26.8.2`.
- Original Go: commit `db1b7050e0b5ecd70c808728b989816e9320c468`, `GOGC=100`, no PGO, no SIMD. Its executable hash matches the original baseline recorded in the earlier CPU comparison.
- Pre-follow-up Go: commit `a750604`, `GOGC=800`, its supplied PGO, scalar build.
- Latest Go: current uncommitted source, `GOGC=800`, fresh PGO, `GOEXPERIMENT=simd`, nearest-eight enabled.
- Node: current shared source, matching motion and collision rules, normal V8 GC settings.

The harness runs real complete in-memory sessions with procedural regions and all players, plus binary snapshot acknowledgement processing. Process startup, initial setup, warmup, compilation and profile collection are outside timed samples. No concurrent builds, tests or compression jobs ran during measurement. Node CPU includes all process threads even though affinity is pinned.

Validation passed: full `npm test`; `npm run test:go` with regenerated shared fixtures; complete scalar and experimental Go suites; SIMD exactness tests; AVX2-disabled runtime tests; ARM64 scalar-fallback cross-compilation; lint and formatting; production builds before and after. Lint retains two existing `unicorn(no-new-array)` warnings.

| Resource                  | Earlier bytes / gzip-level-1 bytes | Latest bytes / gzip-level-1 bytes |
| ------------------------- | ---------------------------------: | --------------------------------: |
| Client entry              |                   114,085 / 50,369 |                  115,157 / 50,909 |
| Docked chunk              |                      4,708 / 2,432 |                     4,708 / 2,431 |
| Sound chunk               |                        1,681 / 942 |                       1,681 / 942 |
| Node server               |                    99,358 / 42,958 |                  100,475 / 43,458 |
| Stripped static Go server |                      7,889,056 / — |                     7,938,208 / — |

The existing client-entry chunk remains above the repository’s 14 KB loading target; this follow-up changes its gzip size by the amount shown above and preserves loading boundaries.

Executable and profile SHA-256 hashes are recorded with all samples in [the final result](../../benchmarking/results/2026-10-01-cpu-followup-final.json.gz). [Go build settings](../../benchmarking/results/2026-10-01-cpu-followup-build-info.txt) identify the timed test executable and the stripped production executable. The [reproduction instructions](../../benchmarking/experiments/README.md) include original-baseline builds, optional checkpoint sampling, and independent feature toggles.

```text
original executable SHA-256: f692c9dc88f9547404f07d633e0d1b50f044bb40de6d03b609a1970f8267acf3
checkpoint executable SHA-256: 3fad1f8c1e963fd8f58e09b2a7c2dca5b79e465d23b7de7849524b02b0cdb535
latest executable SHA-256: 1a4505e42327f79aca23ee48578e892fcc8df3e6b8371f586f5a23ac1554beb3
node executable SHA-256: 8a22a371fd85aecf5411636574309f6380fbc42694aaf0651a089a8ef9c44e52
latest PGO SHA-256: 1d77b5ac1d74c4aed4886f78c5affe12307a292d13007715fab4988d9ef33475
production Go source SHA-256: 3da5048337814e30669663b165cb25ce86f80fd8a9d85cba41699431840b2c0c
```

The source hash concatenates lexically sorted relative paths, a zero byte and
file contents for production `.go` files under `cmd` and `internal`, excluding
`_test.go`; the profile has its own hash.
