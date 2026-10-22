# Removing NPC clearance distance — 20 October 2026

> Evidence for this completed investigation is in the
> [2026-10-20 archive](../../../benchmarking/archive/README.md#2026-10-20).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-20`.

The experiment did not support removing `clearanceDistance`. Production remains
at 1. Complete removal passes the movement tests, but changes pursuit behavior:
accumulated excess lag rises 5.5%, time beyond 700 units rises 21.5%, and the
paired combat benchmark measures 3.1% higher aggregate CPU cost.

## What was tested

The baseline is the accepted controller from the
[NPC maneuver investigation](npc-maneuvers.md). Temporary Go overlays compare its
one-unit extra margin with zero, then remove the property entirely from the
TypeScript spec, Go schema, generated catalog, route calculations, broad phase,
and predictor. No production source was changed.

The complete-removal prototype retains the ship's physical navigation radius,
including collider skin. It also preserves the existing overlap-escape limits
and score: a ship starting inside an obstacle's navigation circle must still
prefer increasing clearance. Removing the extra margin does not make that score
redundant. Every logged movement metric matches between the zero-value and
full-removal prototypes.

Removing a few additions and field reads saves little arithmetic. The margin
also affects clear-segment tests, avoidance scores, and the route grid's cell
size. For the Courser, cells shrink from approximately 38.56 to 37.56 units,
increasing potential cell count in the same area by roughly 5%. Different
detours and maneuver choices affect much more work than the removed arithmetic.

## Pursuit results

Both variants pass all 33 existing quality cases, with unchanged fixtures and
acceptance budgets. These include 20 five-minute curving chases, seven spinning
fields, three continuous orbits, and three short straight-gap crossings.

| Metric across 20 curving chases      |           Clearance 1 |               Removed |
| ------------------------------------ | --------------------: | --------------------: |
| Excess lag integral beyond 300 units | 69,894.6 unit-seconds | 73,738.2 unit-seconds |
| Time beyond 700 units                |         25.39 seconds |         30.84 seconds |
| Asteroid contacts                    |                     1 |                     1 |
| Player-ship contacts                 |                    13 |                    12 |

The result is mixed. Fourteen additional fields improve by 21.9% in excess lag,
while the six permanent curving cases regress by 41.8%. Most of the regression
comes from seed 9: the physical-target case spends 17.57 seconds beyond 700 units,
compared with 4.53 seconds at clearance 1. It still passes its 17.627-second
budget, but the reduced margin does not preserve the current pathing.

## CPU comparison

The full-removal implementation was compiled with the same Go 1.27.1,
`GOEXPERIMENT=simd`, and production PGO input as the accepted baseline. Five
alternating pairs each run 9,000 measured ticks per scenario, using production
`GOGC=800` and automatic Go scheduling. No builds, tests, profiling, or compression
run concurrently with the measurements.

| Scenario                           | Before, microseconds CPU/tick | Removed, microseconds CPU/tick |
| ---------------------------------- | ----------------------------: | -----------------------------: |
| Open space                         |                        18.273 |                         19.738 |
| Normal field                       |                        37.690 |                         36.291 |
| Dense field                        |                        50.881 |                         50.656 |
| Normal field, full-throttle player |                        42.183 |                         41.709 |
| Dense field, full-throttle player  |                        54.666 |                         61.634 |

These are medians. The sum of the five case medians increases by 3.11%. All
activity checks pass, but NPC movement and firing differ: dense-fast maximum
separation increases from 628 to 773 units and firing rises from 20.67% to 24.67%
of measured ticks. The benchmark measures whole-session work, including physics,
weapons, and snapshots; setup, warmup, TCP, and control decoding are excluded.
It does not isolate the cost of the removed additions, and small CPU differences
remain sensitive to measurement variation.

The [saved evidence](../../../benchmarking/experiments/2026-10-20/npc-clearance/)
contains the experimental source, raw quality and CPU results, and provenance.
The starting build passes and the experimental NPC suites pass. Production code
and shipped resource sizes are unchanged.
