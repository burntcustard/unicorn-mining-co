# Courser collection CPU — 21 October 2026

> Evidence for this completed investigation is in the
> [2026-10-21 archive](../../../benchmarking/archive/README.md#2026-10-21).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-21`.

The later [code simplification](pirate-collection-simplification.md) describes the
current implementation. This report preserves the preceding CPU optimization
and its historical measurements.

The optimized collector uses **50.72% less process CPU** than the initial fast
collector while preserving every measured pickup result. It also uses **11.18%
less CPU than the original slow collector** in the same complete-haul workload.
The primary eight-item fixture still takes **21.77 simulation seconds**, versus
85.33 seconds before the collection behavior was fixed.

## Measurements

Five sequential runs alternate three separately compiled executables. Each run
performs ten complete hauls for each of the four seeded scenarios: 40 hauls per
executable. Compilation and other tests finish before measurement. All variants
use `CGO_ENABLED=0`, `GOEXPERIMENT=simd`, `GOGC=800`, and `-trimpath` on the same
host.

| Collector                | Median process CPU, seconds |
| ------------------------ | --------------------------: |
| Original slow behavior   |                    1.523381 |
| Initial fast collector   |                    2.745547 |
| Optimized fast collector |                    1.353037 |

Process CPU is child user plus system time for the complete executable, including
fixture setup and the test harness. It measures the cost of completing these
hauls; it does not predict a live server's CPU reduction across a mixed fleet.

| Scenario | Initial fast, wall ms/haul | Optimized, wall ms/haul | Simulation seconds, both |
| -------- | -------------------------: | ----------------------: | -----------------------: |
| Primary  |                      53.42 |                   27.21 |                    21.77 |
| Compact  |                      76.28 |                   32.87 |                    29.23 |
| Wide     |                      70.53 |                   35.28 |                    35.40 |
| Heldout  |                      68.99 |                   35.68 |                    33.43 |

The [raw CPU comparison](../../../benchmarking/archive/README.md#2026-10-21)
contains every sample and the execution orders. Earlier intermediate measurements
remain in the archive; `cpu-comparison.json` and `final-cpu-*.log` describe the
retained implementation.

## What changed

The initial profile attributed approximately 75% of sampled CPU to collection
planning. It transformed the same shapes repeatedly and queried hull contacts
for candidates that could not improve the chosen approach. In equal profiles of
30 hauls per scenario, sampled CPU attributed to collection planning falls from
6.03 to 1.68 seconds, approximately 72.14% less. Total sampled CPU falls from
8.05 to 3.90 seconds; the controlled five-run comparison above determines the
reported whole-haul CPU reduction.

The planner now shares item forecasts across candidates and caches hatch offsets
and local hull transforms across thrust choices for one heading. These caches
remain local to the decision and heading. Conservative circles enclosing each
actual collision shape reject separated pairs before a detailed contact query.
Their radii include collision skins, linear slop, and native polygon-clipping
corner reach for large custom margins. Rotated contact regressions cover those
corners, default skins, and circles.

Candidate pruning uses the existing score. Geometric distance plus elapsed-time
cost is a lower bound because contact penalties only increase. A suffix minimum
bounds every remaining step, allowing the planner to stop once no remaining
score can beat the current choice. The same bound stops an unsuccessful contact
scan immediately after its penalty becomes decisive. A coordinate-distance bound
also avoids calculating a square root when that step cannot improve the result.

The AI decision interval, four-second forecast, 40 prediction steps, 20 heading
choices, five thrust choices, candidate order, scoring, and ordinary obstacle
avoidance remain the same.

## Equivalence and limits

All 12 collection scenarios were repeated three times. Their complete result
objects match the initial fast collector exactly, including all eight pickup
times, pickup order, distance traveled, and slow time. Reproducing the archived
initial fast collector also matches all 36 result objects and the prior
investigation's saved results exactly.

A separate seeded oracle compares the optimized controller with the archived
exhaustive controller over 1,000 states. Thrust and turn match bit for bit in
every state. Coverage includes 500 Courser and 500 Arrow states, 800 real polygon
items and 200 circles, varied velocity and spin, pickup distances, hatch
animation, 1,485 hull/module health changes, 52 disabled hatch segments, and
33 absent targets. Independent pilots reuse forecast storage, and the experiment
alternates which implementation runs first.

The haul fixtures still use clear space, eight gold items, replenished fuel,
and an extended encounter timeout. They include real movement and physical
pickup contacts, but exclude combat, station travel, network transport, and the
return trip. The broader oracle checks control equivalence for its sampled
states; it does not establish every possible encounter outcome.

The production build, lint, Go formatting check, all 68 Node checks, and all Go
package tests pass. The complete suite ran with `npm test -- --skip-build` after
the successful production build. Archived-overlay reproduction and the
1,000-state oracle also pass using the documented commands.

All 14 client resources remain byte-for-byte identical, totaling 305,788 raw
bytes. The server grows from 13,365,408 to 13,369,504 bytes (+4,096).
Deterministic gzip level 9 grows from 5,631,459 to 5,633,810 bytes (+2,351).

The [evidence archive](../../../benchmarking/archive/README.md#2026-10-21)
contains source snapshots, raw results, profiles, the oracle, and reproduction
commands. The [collection behavior report](pirate-collection.md) retains the
original investigation and the historical CPU increase that prompted this work.
