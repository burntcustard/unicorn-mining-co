# Go server CPU comparison — 2026-10-01

The current uncommitted Go implementation is **2.06× faster on average** across
16 complete-session benchmarks than the committed implementation before this
optimization pass. Every scenario uses less CPU; individual speedups range from
1.74× to 2.58×.

**Before:** commit `db1b7050e0b5ecd70c808728b989816e9320c468`, with
`GOGC=100` and no profile-guided optimization (PGO).
**Current:** the uncommitted Go source, with the retained optimizations,
`GOGC=800`, and the supplied [PGO profile](../cmd/go-server/default.pgo).
These are the respective production configurations, so the comparison includes
both source changes and compiler/GC configuration changes.

## CPU per tick

Each number is the median of **seven independent process runs**. CPU measures
user plus system time for the entire session, including all players.
**Lower CPU is better; higher speedup is better.** CPU reduction is
`(1 − current / before) × 100%`.

| Players | Scenario | Before CPU ms/tick | Current CPU ms/tick | CPU reduction |   Speedup |
| ------- | -------- | -----------------: | ------------------: | ------------: | --------: |
| 4       | convoy   |           0.049903 |            0.019334 |         61.3% | **2.58×** |
| 4       | spread   |           0.118838 |            0.056422 |         52.5% | **2.11×** |
| 4       | contact  |           0.065840 |            0.029901 |         54.6% | **2.20×** |
| 4       | module   |           0.189346 |            0.093148 |         50.8% | **2.03×** |
| 8       | convoy   |           0.100209 |            0.042560 |         57.5% | **2.35×** |
| 8       | spread   |           0.213910 |            0.102339 |         52.2% | **2.09×** |
| 8       | contact  |           0.119579 |            0.057524 |         51.9% | **2.08×** |
| 8       | module   |           0.391989 |            0.206681 |         47.3% | **1.90×** |
| 16      | convoy   |           0.237756 |            0.120426 |         49.3% | **1.97×** |
| 16      | spread   |           0.480981 |            0.254352 |         47.1% | **1.89×** |
| 16      | contact  |           0.245919 |            0.122133 |         50.3% | **2.01×** |
| 16      | module   |           0.985957 |            0.500484 |         49.2% | **1.97×** |
| 32      | convoy   |           0.643210 |            0.369042 |         42.6% | **1.74×** |
| 32      | spread   |           1.415501 |            0.722728 |         48.9% | **1.96×** |
| 32      | contact  |           0.487357 |            0.245000 |         49.7% | **1.99×** |
| 32      | module   |           2.475341 |            1.189536 |         51.9% | **2.08×** |

The **arithmetic mean of the 16 speedups is 2.060×**; the geometric mean is
2.052×. Giving every scenario equal measured duration and summing their CPU
instead gives **1.9899×**, or
**49.75% less total CPU**. These are different weighting
methods: the requested average across benchmarks exceeds 2×, while the aggregate
CPU ratio is approximately 2×. Individual scenarios do not all reach 2×.

## Allocations and memory

Allocations and allocated bytes are per measured tick. RSS is the median of each
process's peak resident memory, including setup and warmup. Allocated memory per
tick falls in every scenario; peak memory rises because the higher `GOGC` allows
more memory between garbage collections, and retained caches also consume memory.

| Players | Scenario | Allocations/tick before → current | Allocated KiB/tick before → current | Peak RSS MiB before → current |
| ------- | -------- | --------------------------------: | ----------------------------------: | ----------------------------: |
| 4       | convoy   |                      421.9 → 58.6 |                         18.7 → 10.3 |                   31.3 → 69.2 |
| 4       | spread   |                     593.0 → 153.7 |                         35.3 → 18.0 |                   33.9 → 70.1 |
| 4       | contact  |                     440.6 → 107.8 |                         25.7 → 10.2 |                   31.2 → 69.9 |
| 4       | module   |                    1143.3 → 349.4 |                         66.1 → 28.3 |                   32.5 → 71.6 |
| 8       | convoy   |                     884.1 → 123.5 |                         47.3 → 28.9 |                   35.7 → 72.8 |
| 8       | spread   |                    1026.8 → 241.7 |                         59.5 → 31.0 |                   38.5 → 73.9 |
| 8       | contact  |                     869.3 → 206.5 |                         52.2 → 20.7 |                   33.4 → 69.4 |
| 8       | module   |                    2342.3 → 697.3 |                        140.2 → 54.7 |                  37.6 → 100.5 |
| 16      | convoy   |                    1959.8 → 287.4 |                        124.6 → 79.4 |                  39.7 → 102.2 |
| 16      | spread   |                    2113.1 → 487.3 |                        130.7 → 64.6 |                   40.5 → 99.8 |
| 16      | contact  |                    1781.7 → 398.6 |                        110.8 → 40.2 |                   36.5 → 89.5 |
| 16      | module   |                   5062.2 → 1491.4 |                       321.0 → 128.4 |                  43.9 → 106.8 |
| 32      | convoy   |                    4584.3 → 765.8 |                       329.9 → 200.9 |                  46.8 → 141.7 |
| 32      | spread   |                   4997.2 → 1078.3 |                       335.9 → 162.7 |                  54.9 → 169.7 |
| 32      | contact  |                    3579.5 → 710.4 |                        217.5 → 66.5 |                  43.3 → 104.4 |
| 32      | module   |                  10714.4 → 3288.5 |                       761.7 → 332.6 |                  56.2 → 167.4 |

A separate sustained GC comparison used the optimized implementation on both
sides, with `GOGC=100` versus `800`, for **6,000 measured ticks and three runs per
32-player scenario**. The module scenario reached a median peak RSS of
**382.9 MiB** at `800`, versus **103.6 MiB** at `100`; the largest observed peak at
`800` was **385.6 MiB**. This isolates the GC setting rather than comparing the
original and current source. See the
[sustained GC samples](../benchmarking/results/2026-10-01-cpu-final-gc-sustained.json.gz).

## Tick duration

These are elapsed tick-processing times, separate from CPU accounting and network
latency. p95 and p99 are medians of per-run percentiles. Worst tick is the single
largest tick across all seven runs; it is sensitive to occasional scheduling and
GC delays. All p95/p99 entries improve, but several worst ticks increase.

| Players | Scenario | Before p95 / p99 ms | Current p95 / p99 ms | Before worst tick ms | Current worst tick ms |
| ------- | -------- | ------------------: | -------------------: | -------------------: | --------------------: |
| 4       | convoy   |       0.112 / 0.270 |        0.039 / 0.064 |                1.796 |                 0.120 |
| 4       | spread   |       0.234 / 0.444 |        0.092 / 0.186 |                2.037 |                 0.457 |
| 4       | contact  |       0.126 / 0.169 |        0.039 / 0.048 |                1.255 |                 0.090 |
| 4       | module   |       0.408 / 0.715 |        0.180 / 0.296 |                2.024 |                 0.427 |
| 8       | convoy   |       0.212 / 0.642 |        0.092 / 0.326 |                1.541 |                 0.843 |
| 8       | spread   |       0.411 / 0.739 |        0.180 / 0.325 |                1.429 |                 0.541 |
| 8       | contact  |       0.217 / 0.300 |        0.074 / 0.091 |                1.495 |                 1.328 |
| 8       | module   |       0.857 / 1.770 |        0.396 / 0.500 |                2.672 |                 3.066 |
| 16      | convoy   |       0.686 / 1.322 |        0.391 / 0.810 |                3.036 |                 2.575 |
| 16      | spread   |       0.825 / 2.095 |        0.453 / 0.704 |                4.689 |                 3.647 |
| 16      | contact  |       0.449 / 1.188 |        0.181 / 0.206 |                1.865 |                 0.537 |
| 16      | module   |       2.155 / 3.293 |        0.865 / 1.334 |                6.523 |                 4.484 |
| 32      | convoy   |       1.728 / 3.193 |        1.070 / 2.741 |                5.756 |                 7.639 |
| 32      | spread   |       2.648 / 5.923 |        1.103 / 1.668 |               10.298 |                 6.225 |
| 32      | contact  |       0.886 / 1.213 |        0.318 / 0.453 |                2.223 |                 3.010 |
| 32      | module   |       5.237 / 7.751 |        1.981 / 2.774 |               13.677 |                 8.451 |

## Contact-list review

Item and asteroid collision detection, continuous collision handling, momentum
resolution and impact damage remain in `GameCollisions.Step`, which runs before
contact dispatch. `UpdateWorld` builds additional **gameplay callback lists** for
docking, scooping and drilling. Skipping those duplicate lists for objects
without `HandleContacts` does not remove their physics or their contacts from a
ship's or station's callback list.

The dispatch was simplified: `gameplayContacts` and `contactHandlers` now name the
buffers explicitly, the separate `contactQueued` flag was removed, and an empty
list identifies each handler's first contact. Buffer cleanup releases references
after dispatch. Stations still handle their contacts before ships; first-seen
owner order and contact order remain unchanged.

Both alternatives were measured independently against the previous uncommitted
implementation, using `GOGC=800` on both sides, 900 timed ticks and five paired
runs of each of the 16 scenarios. CPU change below is the arithmetic average of
per-scenario current/previous CPU ratios, minus one.

| Contact dispatch alternative                             | Average CPU change | Decision                                                 |
| -------------------------------------------------------- | -----------------: | -------------------------------------------------------- |
| Rebuild an ordered map of contact lists each tick        |             +4.60% | Reject: contact-heavy scenarios use 8.36–19.68% more CPU |
| Reuse buffers with simpler bookkeeping and clearer names |             +0.40% | Keep: simpler code, with less than 1% average change     |

[Map comparison samples](../benchmarking/results/2026-10-01-cpu-contact-map-review.json.gz)
and [cleanup comparison samples](../benchmarking/results/2026-10-01-cpu-contact-simplification-review.json.gz)
retain all measured outcomes. Both comparisons match on contact counts, events,
near-zero collision notification counts, entity counts, packet counts, encoded
bytes and final ship states. The main tables
above were rerun against the original baseline **after** keeping the cleanup.

New regression tests exercise Gold and Amethyst against asteroids, items and
ordinary GameObjects through `UpdateWorld`, with no gameplay contact handlers.
All six cases verify physical contacts, momentum transfer, damage, collision
events and departure from free motion. A separate test verifies callback order,
contact order and clearing between successive ticks. All Go tests, production
builds before and after, and lint pass; lint retains two existing TypeScript
`unicorn(no-new-array)` warnings. Client entry and lazy chunk outputs are unchanged
by this cleanup (entry: 114,085 bytes / 50,369 gzip-level-1 bytes).
The stripped static Go executable also remains 7,889,056 bytes.

## Measurement and validation

- AMD Ryzen 7 5800X3D, Go 1.27.1 linux/amd64; both versions run sequentially on
  logical CPU 0 with `GOMAXPROCS=1`. Process order alternates by repetition.
- Seed 25, 120 warmup ticks, then 900 measured ticks at the fixed 30 Hz simulation
  step, executed as fast as possible. Binary snapshots retain their 15 Hz cadence.
- Convoy groups nearby ships; spread distributes ships across regions; contact
  places opposing pairs close together; module exercises drilling targets and
  hatch/light transitions, replenishing targets every 120 measured ticks.
- Timing includes region lifecycle, simulation, collision physics, gameplay
  modules, per-player replication, binary encoding and acknowledgements through
  in-memory socket sinks. It excludes compilation, startup, warmup, trace writing
  and operating-system WebSocket I/O. No other performance job runs concurrently.
- The 224 timed processes matched between versions on contact counts, gameplay
  event counts above the `2e-8` collision-impact threshold, entity counts, packet
  counts and encoded-byte totals. Final ship
  states agreed within `2e-8`; the largest recorded position difference was about
  `1e-8` units. This timed comparison does not trace individual snapshots.
- Full Go tests passed after the contact-buffer cleanup. TypeScript tests,
  including prediction/reconciliation, and the Go networking race test passed at
  the preceding checkpoint; this cleanup changes no TypeScript source. At that
  checkpoint, a separate Go/Node parity run checked
  **108,000 decoded snapshots** across all 16 scenarios. Its maximum numeric
  difference was `3e-7`, within the `1e-6` tolerance for 32-player runs; runs with
  up to 16 players use `2e-8`.
- The separate Go/Node comparison filters collision events below `2e-8`, except
  the 32-player module scenario, which uses `0.025` to accommodate previously
  verified ordering differences in the original implementations. The timed
  Go-before/Go-current comparison above uses `2e-8` for collision event counts
  in every scenario, with smaller notifications recorded separately. In the
  32-player module scenario, those notifications number 152 before the entire
  optimization pass and 148 currently; their counts match in every other
  scenario. The contact-buffer cleanup itself changes none of these counts.

The primary evidence is the
[complete before/current samples](../benchmarking/results/2026-10-01-cpu-contact-review-final.json),
including allocation, memory, latency, outcome and executable-hash records.
The separate [Go/Node parity results](../benchmarking/results/2026-10-01-go-parity-final.json)
and [original 32-player module parity audit](../benchmarking/results/2026-10-01-original-32-module-parity.json)
record the numerical tolerances and original ordering check.

The measured current Go production source matches the working tree when this
report was written. Its SHA-256, computed over sorted paths in `cmd/` and
`internal/`, excluding `_test.go` files and hashing each path and contents with
NUL separators, is:

```text
7816874163b047bffbf5b803ccb23f7dc099e1d3c15ad13fcbde6904a610188a
```

This is a checkpoint for the current uncommitted implementation. Further
requested SIMD, rounding, package naming and closest-eight collision experiments
are not represented as completed changes in these measurements.

## Reproduce the paired comparison

Build separate benchmark executables from the original and current source. Use
the same extended benchmark harness and telemetry in both checkouts; build the
original without PGO and the current with the supplied profile. From each
respective checkout:

```sh
# Original production source, with the extended harness copied in:
GOCACHE=/tmp/unicorn-go-cache go test -pgo=off -c \
  -o /tmp/go-cpu-before ./internal/server

# Current working tree:
GOCACHE=/tmp/unicorn-go-cache go test -pgo=./cmd/go-server/default.pgo -c \
  -o /tmp/go-cpu-current ./internal/server
```

Then run from the current checkout:

```sh
REPETITIONS=7 BEFORE_GOGC=100 AFTER_GOGC=800 \
  node benchmarking/go-cpu-paired.mjs \
  cpu-comparison-recheck /tmp/go-cpu-before /tmp/go-cpu-current
```

The driver selects the first allowed logical CPU and runs all 16 cases
sequentially, alternating version order. It preserves this report's raw data and
writes a new results file under the supplied label.

See the [earlier Go/Node benchmark](go-server-benchmark-2026-09-30.md) for the
historical runtime comparison. Its numbers answer a different question from
this Go-before/Go-current optimization comparison.
