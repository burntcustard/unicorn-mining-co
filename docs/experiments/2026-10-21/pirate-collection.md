# Courser pirate collection — 21 October 2026

> Evidence for this completed investigation is in the
> [2026-10-21 archive](../../../benchmarking/archive/README.md#2026-10-21).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-21`.

The later [code simplification](pirate-collection-simplification.md) describes the
current implementation. This report preserves the original behavior investigation
and its historical measurements.

The primary seeded collection run improves from **85.33 to 21.77 simulation
seconds**, or **3.92× faster**, for eight actual cargo pickups. All 12 scenarios
improve. Their summed completion time falls from 896.90 to 452.30 seconds,
**49.57% less time**; this aggregate gives each fixture one equal-weight run.
The primary result is approximately four times faster; the other fixtures
improve by factors of 1.18–3.41.

## What caused the hesitation

The original arrival controller aimed to coast to a stop near the target. With
an item at the hatch hinge, it could request zero thrust even though the item
had not reached the pickup throat. The physical doors, narrow channel, and
velocity cutoff make a small remaining gap significant. Recomputing the nearest
loot item could also abandon an approach before the pickup occurred.

Recovery had another failure: its escape waypoint remained attached to the
item's moving position and inherited the item's velocity. A ship and an item
wedged together could keep moving together while chasing that waypoint. An
additional validation seed exposed a 247.4-second run before this was fixed.

The retained controller keeps one loot target until it is collected. For
collection, it forecasts ordinary thrust and turn controls over four seconds,
scores passage through the actual pickup throat, and penalizes physical hull
contacts with the real item shape. The aim lies five units beyond the throat
center so slowing cannot leave the item at its entrance. Normal obstacle
avoidance still has priority. Recovery commits to a fixed world position and
clears inherited target velocity, allowing a wedged ship to separate.

Near stations, a controlled collection approach requests a closing speed of
40–50 units/second. Normal avoidance
continues to apply. This prevents fast glancing contacts from knocking cargo
into docking interiors that the ordinary collection route cannot enter. The
guard covers the station radius, four seconds of maximum-speed travel, and the
ship's physical radius; it leaves the clear-area benchmark results unchanged.

Hull and item collision geometry are prepared once per decision. The general
collision query can reuse those shapes, and its contact manifold stays on the
stack. The longer collection forecast uses reusable storage; ordinary obstacle
avoidance retains its original horizon.

## Seeded results

All measurements include normal session ticks and physical pickup contacts.
The seeded square has coordinates from `-spread` to `+spread` on each axis;
headings, item rotations, minimum initial range, and item spacing are also fixed.

| Scenario   |     Seed | Spread | Before, seconds | After, seconds | Speedup |
| ---------- | -------: | -----: | --------------: | -------------: | ------: |
| Primary    |       25 |    180 |           85.33 |          21.77 |   3.92× |
| Compact    |       67 |    120 |           67.83 |          29.23 |   2.32× |
| Wide       |      123 |    300 |           65.90 |          35.40 |   1.86× |
| Heldout    |      501 |    180 |           70.13 |          33.43 |   2.10× |
| Validation |        8 |    180 |           57.80 |          41.20 |   1.40× |
| Validation |       42 |    180 |           69.27 |          32.20 |   2.15× |
| Validation |       73 |    180 |           63.97 |          27.60 |   2.32× |
| Validation |      211 |    240 |           75.37 |          28.03 |   2.69× |
| Validation |      809 |    240 |           91.77 |          26.93 |   3.41× |
| Validation |      977 |    240 |           93.07 |          55.43 |   1.68× |
| Validation |     2026 |    300 |           78.20 |          54.73 |   1.43× |
| Validation | 20261021 |    120 |           78.27 |          66.33 |   1.18× |

The three final repeats match exactly for every complete result object, including
all eight pickup times, pickup order, distance, and slow time. In the primary
case, the longest interval before a pickup falls from 16.43 to 4.70 seconds.
The normal tests enforce completion budgets for all 12 cases, alongside focused
regressions for restarting at the hinge and moving through the physical channel.

## Experiments and limits

Correcting the throat aim alone left the primary run at 85.17 seconds. A minimum
approach speed reduced it to 50.60 seconds; locking the target reached 41.23.
Simple speed caps and several proactive staging approaches produced inconsistent
results or substantially longer runs. Heading-aware selection and exhaustive
eight-item route planning also failed to improve the cases consistently. The
retained forecast evaluates entry geometry and reachable controls directly.

Collection is more active: total travel across the 12 fixtures rises from
49,228 to 67,382 units, approximately 36.88%, despite the shorter completion time.
This may increase fuel use. The initial forecast implementation also increased
CPU cost; the follow-up optimization described below removes that measured
whole-haul CPU increase while preserving the pickup results.

## CPU cost and validation

The [CPU follow-up](pirate-collection-cpu.md) reduces process CPU by **50.72%**
against the initial fast collector and **11.18%** against the original slow
collector in a new matched comparison. All 12 complete pickup results remain
identical. The measurements below document the historical initial implementation
that prompted that optimization.

Initial whole-haul wall-time medians are shown below. Each includes fixture setup
and the complete collection run. Three sequential before/final executable pairs
alternate their execution order, using the same host and matched
`CGO_ENABLED=0`, `GOEXPERIMENT=simd`, `GOGC=800`, `-trimpath`, and three hauls
per case per run.

| Scenario | Before, wall milliseconds/haul | After, wall milliseconds/haul |
| -------- | -----------------------------: | ----------------------------: |
| Primary  |                          44.98 |                         54.82 |
| Compact  |                          36.43 |                         71.52 |
| Wide     |                          38.43 |                         73.60 |
| Heldout  |                          30.37 |                         66.79 |

At that stage, median process CPU for the whole four-case executable rose from
0.479044 to 0.837899 seconds, **74.91% more CPU**, including fixture setup and
test-harness work. This historical measurement does not describe the optimized
collector. Neither comparison measures an isolated controller call or predicts
the CPU cost of a live server's particular mixture of encounters.

For the initial implementation, the production build, lint, Go formatter check,
all 68 Node checks, and all Go package tests passed. Existing station
surrender/sale tests and the test that mines new cargo after an appeased
encounter passed with their original completion deadlines and sale assertions.

The fixtures use clear space, eight gold items, replenished fuel, an extended
encounter timeout, and an empty eight-slot cargo hold. They isolate pickup
behavior; they exclude combat, station travel, release delays, network transport,
and the return trip. They do not establish a fourfold gain for other item shapes
or collection inside an asteroid field. Real item shapes and normal collision
mechanics remain active; focused tests cover the other valuable item types.

At that stage, all 14 client resources retained identical sizes, totaling 305,788
raw bytes. The server grew from 13,353,120 to 13,365,408 bytes (+12,288).
Deterministic gzip level 9 grew from 5,626,018 to 5,631,459 bytes (+5,441).

The [evidence archive](../../../benchmarking/archive/README.md#2026-10-21)
contains raw logs, exact before/after metrics, preserved baseline sources,
resource measurements, and commands that reproduce both versions without
changing the checkout.
