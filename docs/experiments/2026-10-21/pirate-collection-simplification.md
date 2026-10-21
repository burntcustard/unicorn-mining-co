# Courser collection simplification — 21 October 2026

The collection and movement implementation is **75 lines shorter**, from 588 to
513 lines across four production files. The controller and collision helper
shrink from 272 to 177 lines, approximately **35% less code**. The four primary
eight-item pickup times remain unchanged. One existing validation case improves;
the broader 32-case sample is slightly slower overall.

## What became simpler

Hull shapes now stay fixed in the ship's frame. Each predicted item transform
moves into that frame for the native contact query, replacing repeated hull
transforms and their per-heading preparation cache. Item transforms are still
forecast once per decision.

The planner keeps one array of geometric costs and its minimum. Elapsed time
and accumulated contact penalties provide the remaining lower bound. This
removes the suffix-minimum pass and storage. Improving step scores update the
chosen controls directly, removing a separate candidate-local closest score.
One uniform radius formula covers shapes and collision skins; padding the skin
by `sqrt(2)` conservatively covers native polygon-clipping corners.

Movement computes the actual pickup-throat center once and passes it to the
collector. Both use the current outline, eliminating duplicate hatch selection
and inconsistent cached-center handling. Near-station collection shares the
ordinary desired-velocity and acceleration calculation.

| Production file            | Before, lines | After, lines |
| -------------------------- | ------------: | -----------: |
| Collection controller      |           241 |          155 |
| Collision helper           |            31 |           22 |
| Collection recovery/center |            71 |           93 |
| Movement                   |           245 |          243 |
| Total                      |           588 |          513 |

The four-second forecast, 40 steps, heading/thrust grid, AI decision cadence,
two-second recovery deadline, pickup tolerances, and physical contact queries
retain their existing settings.

## Pickup results

| Scenario             | Before, simulation seconds | After, simulation seconds |
| -------------------- | -------------------------: | ------------------------: |
| Primary, seed 25     |                      21.77 |                     21.77 |
| Compact, seed 67     |                      29.23 |                     29.23 |
| Wide, seed 123       |                      35.40 |                     35.40 |
| Heldout, seed 501    |                      33.43 |                     33.43 |
| Validation, seed 977 |                      55.43 |                     45.10 |

The other seven validation cases also retain their completion times. All 44
fixtures collect all eight items. The original 12 fixtures improve in aggregate
from 452.30 to 441.97 simulation seconds. An additional 32 seeded layouts take
1,190.37 seconds instead of 1,164.17, **2.25% longer**. Across all 44 fixtures,
the total increases from 1,616.47 to 1,632.33 seconds, **0.98% longer**. These
results support simpler code with preserved primary pickup speed; they do not
establish a general collection speedup.

Moving contact evaluation into the ship's frame changes floating-point operation
order. Native shapes and contact queries remain active, but complete result
objects are not claimed to be bitwise identical to the earlier implementation.
Three final repeats produce identical complete result objects for all 44 cases
(132 results). A separate 40,000-state frame-parity experiment preserves contact
presence and depth within `1e-8` for polygon/polygon, polygon/circle,
circle/polygon, and circle/circle pairs.

## Experiments and limits

Smaller heading/thrust grids, simple pursuit, and replacement contact/SAT scoring
produced inconsistent pickup results and were rejected. Removing per-collider
circle rejection saved code but increased CPU by approximately 5% in pinned
prototype measurements, so the retained implementation keeps it.

Shorter recovery deadlines also failed to improve the workload consistently.
Using the intermediate controller, a 1.5-second deadline increased the 44-case
total by 0.78%; a one-second deadline increased it by 8.18%. Each violated three
existing completion budgets. The primary fixture remained at 21.77 seconds, and
every fixture eventually collected all items. The existing two-second deadline
is retained.

The clear-space haul fixtures include normal session ticks and physical pickup
contacts, with replenished fuel and an extended encounter timeout. They exclude
combat, station travel, transport, and the return trip. The 32 additional seeds
broaden layout coverage without establishing performance for every live encounter.

CPU remains roughly unchanged, with slightly lower medians in both final
measurement configurations. Five alternating before/after rounds use matched
`CGO_ENABLED=0`, `GOEXPERIMENT=simd`, `GOGC=800`, and `-trimpath` executables.

| Configuration                          | Hauls per invocation | Before CPU, seconds | After CPU, seconds | Change |
| -------------------------------------- | -------------------: | ------------------: | -----------------: | -----: |
| Unrestricted affinity, `GOMAXPROCS=16` |                   80 |            2.603099 |           2.558454 | -1.72% |
| CPU 0, `GOMAXPROCS=1`                  |                   40 |            1.187085 |           1.180666 | -0.54% |

Each invocation runs four scenarios; CPU includes fixture setup and the harness.
These small differences do not establish a substantial further CPU gain or a
live-fleet CPU reduction. Allocations per primary haul fall from 63,328 to
62,242, with allocated bytes falling from 6,462,821 to 6,418,186. All four
primary cases allocate approximately 1.6–2.1% fewer objects.

The production build, lint, Go formatting check, all 68 Node checks, and every
Go package test pass. The earlier 1,000-state historical oracle also passes when
reproduced with its five preserved NPC snapshots.

All 14 client resources retain identical bytes, hashes, and compressed sizes,
totaling 305,788 raw bytes. The server shrinks from 13,369,504 to 13,365,408 bytes
(-4,096). Deterministic gzip level 9 shrinks from 5,633,810 to 5,632,134 bytes
(-1,676), using the same compressor for both measurements.

The [evidence archive](../../../benchmarking/experiments/2026-10-21/pirate-collection-simplification/README.md)
contains preserved sources, raw experiments, seeded fixtures, and reproduction
commands. The earlier [behavior](pirate-collection.md) and
[CPU](pirate-collection-cpu.md) reports describe the preceding implementations.
