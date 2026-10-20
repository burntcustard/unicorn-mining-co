# NPC pursuit through usable asteroid gaps — 20 October 2026

Selective asteroid geometry and a short, obstacle-clipped pursuit forecast reduce
accumulated excess lag by **28.2% for moving points** and **34.2% for physical
player ships** across 15 five-minute courses of each kind. These expanded results
include five fresh courses per kind. The fresh point courses alone regress by
10.9% in excess lag, so the improvement is an aggregate result rather than a
guarantee that every pursuit becomes faster.

This follows the [circle-navigation investigation](npc-maneuvers.md). Circles
remain the inexpensive broad phase, with asteroid outlines resolving queries
that a circle rejects. Ship physics, engine power, maximum speed, movement
timings, and the one-unit clearance setting remain unchanged. No dependency was
added.

## Retained changes

Asteroid snapshots retain a conservative circle enclosing every outline vertex.
Queries outside that circle avoid polygon work. Inside it, cached local bounds,
an inscribed circle, signed distances, and swept edge checks distinguish a solid
rock from usable space within its radius. Static and forecast queries transform
their endpoints into the asteroid's local frame; forecasts also account for its
observed spin. Stations, gates, items, and the pursued ship retain their circle
obstacles. The NPC's own radius still encloses its physical fixtures and collider
skin.

Only immutable asteroid geometry sources are cached. Mutable outlines rebuild
their bounds, pose changes reuse the local geometry, and retained references are
bounded and cleared from reusable snapshot/forecast slices. Missing or degenerate
outlines keep the conservative circle fallback.

Routing first tries its ordinary circle-node grid. Long or incomplete routes can
try a finer grid and then precise outline nodes. Every edge and shortcut receives
a swept clearance check; opening a grid node does not permit cutting a neighboring
rock's corner. This preserves cheap ordinary routes while allowing a dogleg
through openings that overlapping radius circles incorrectly close.

During a blocked combat pursuit, the route can lead the player's observed linear
motion by at most two response times, currently one second. The forecast is also
bounded by distance divided by the pursuer's maximum speed, and stops before the
target's footprint would cross an obstacle. Each observation replaces the lead;
there is no committed stale interception point or access to future player inputs.

The forecast changes navigation only. Arrival and braking retain the actual
player position. A directly visible lead preserves the target's velocity in the
movement controller; only a genuine route detour removes that feedforward. This
avoids the previous prototype's mistake of treating every predicted point as a
detour and forcing unnecessary maximum-speed approaches.

## Frozen pursuit comparison

The baseline is the accepted circle-only controller at the start of this task.
Both variants use the same fixtures and numeric acceptance budgets. The original
ten courses of each kind comprise three permanent and seven additional generated
curving courses; these were available during investigation. Five additional
courses of each kind use fixed fresh seeds chosen before their controller
outcomes were inspected.

Each chase lasts five simulated minutes at nominal reference speeds of 170, 180, or 190
units per second. Excess lag is the integral of separation beyond 300 units, in
unit-seconds. Escape time counts separation beyond 700 units. These measure
pursuit behavior rather than wall-clock execution time.

| Courses                     | Before excess lag | After excess lag | Change |
| --------------------------- | ----------------: | ---------------: | -----: |
| Original ten moving points  |          30,883.8 |         20,361.7 | -34.1% |
| Original ten physical ships |          39,010.8 |         24,278.9 | -37.8% |
| Fresh five moving points    |           4,656.7 |          5,164.7 | +10.9% |
| Fresh five physical ships   |           4,274.6 |          4,223.1 |  -1.2% |
| Expanded fifteen points     |          35,540.5 |         25,526.4 | -28.2% |
| Expanded fifteen ships      |          43,285.4 |         28,502.0 | -34.2% |

Across the expanded point courses, time beyond 700 units decreases from 14.33 to
6.97 seconds. For physical ships it decreases from 11.06 to 5.63 seconds. Point
courses have no asteroid contacts in either version. Physical courses decrease
from one asteroid contact episode to zero and from twenty player-ship contact episodes to
fourteen; collision-free player pursuit is not claimed.

The fresh point result exposes a remaining weakness: mean separation improves
slightly, from 146.60 to 145.44 units, while its longer-lag tail worsens. Seed 109
increases from 1,246.2 to 1,640.1 unit-seconds and seed 113 from 2,819.3 to 3,524.6.
None of the fresh courses escapes beyond 700 units or touches an asteroid.
Fresh physical-ship contacts decrease from seven to two, although individual
physical courses also regress.

The physical-player variant adds a real colliding ship following an independently
prescribed, bounded reference track. It is not a human player driving with engine
inputs. The generated tracks can change force direction abruptly at joins, and
these deterministic samples do not establish performance on every field or
player maneuver.

## Actual-gap and safety regressions

Three new short crossings come from generated asteroid outlines and rotations.
The reference selection uses geometry before controller outcomes: a 44-unit disk
must fit throughout the crossing, while the radius approximation blocks even a
36-unit disk. These shape-isolation crossings freeze asteroid spin; separate
spinning-field courses retain it. The
retained controller crosses all three with zero contacts, zero excess lag, and
zero measured lateral offset at the gap. This specifically verifies using real
openings rather than recovering faster after a broad detour.

The integrated quality replay passes 46 course cases: thirty five-minute curving
chases, seven spinning-field courses, three continuous orbits, three existing
straight gaps, and the three new physical-outline gaps. Additional focused
regressions compare accepted sweeps with independent asteroid contacts, exercise
rotated and spinning outlines, invalidate replaced/mutable geometry, preserve
degenerate-outline safety, and require a dogleg through a circle-disconnected
cluster. Interception tests verify clipping, immediate response to a changed
target velocity, and settling at the actual player's spacing after braking.

The planner remains a bounded local grid, and the collision forecast samples
ordinary controls over a finite horizon. Linear pursuit forecasts cannot know
which turn a player will choose. These limits, the fresh point regressions, and
remaining ship contacts are retained in the evidence rather than hidden by an
aggregate percentage.

## Investigation and rejected alternatives

The investigation considered bounded linear/curved interception, relative
velocity guidance, proportional-navigation ideas, response-time changes, shorter
collision horizons, and more detailed obstacle geometry. Long leads and several
controller changes improved selected point courses while regressing physical
ships. Shorter prediction horizons and the full target-velocity controller were
rejected. The retained lead stays short and uses the existing response-time
setting; no additional tuning property was introduced.

Profiling found grid searches to be the main added cost. Reordering retries
around deeply circle-obstructed destinations saved only one search across the
quality suite and required substantially more reasoning and code, so it was
discarded. Replacing bounded grid distances with square roots of squared
distances changed two physical trajectories without a useful measured CPU gain;
it was also rejected. The final cleanup skips detailed-node retries when every
obstacle is circular and checks forecast geometry directly in its cached local
frame. All 46 course metrics and all 198 planned waypoint lists remain exactly
unchanged after this cleanup.

Reynolds' [steering paper](https://www.red3d.com/cwr/steer/gdc99/) and
[OpenSteer's pursuit implementation](https://github.com/meshula/OpenSteer/blob/master/include/OpenSteer/SteerLibrary.h)
provide context for bounded future-position pursuit. The implementation here
uses this game's existing controller and collision geometry; no third-party
source was copied.

## CPU, resource sizes, and final validation

The final controller uses **4.73% more whole-session process CPU** in aggregate
than the accepted circle-only baseline. This is a measured pursuit/CPU tradeoff.
Each cell below is the median of five alternating before/after runs, with 9,000
timed ticks per case and run. The aggregate compares sums of case medians, giving
each case the same number of simulated ticks.

| Scenario                           | Before, microseconds CPU/tick | After, microseconds CPU/tick | CPU change |
| ---------------------------------- | ----------------------------: | ---------------------------: | ---------: |
| Open space                         |                        20.041 |                       19.553 |     -2.44% |
| Normal asteroid field              |                        35.575 |                       36.621 |     +2.94% |
| Dense asteroid field               |                        51.448 |                       53.726 |     +4.43% |
| Normal field, full-throttle player |                        42.197 |                       43.446 |     +2.96% |
| Dense field, full-throttle player  |                        58.059 |                       63.770 |     +9.84% |

The benchmark includes one real player, one fighting pirate, session input,
weapons, physics, and replication in generated fields. Process user plus system
CPU excludes setup and warmup, binary control decoding, TCP, and timers. Both
binaries use Go 1.27.1 with SIMD, the unchanged production PGO, `GOGC=800`, and
automatic scheduling (16 processors on this host). Builds, tests, profiling,
and compression were excluded from the sequential measurement window.

All activity checks pass: both controllers fight throughout, fire in every case,
and remain in the field throughout asteroid cases. The fast players average
about 192 and 179 units per second. Their maximum separation improves from 832.5
to 293.7 units in the normal field and from 628.2 to 273.0 in the dense field.
Inputs are identical but resulting movement and firing differ, so these figures
measure the full changed workload rather than geometry arithmetic in isolation.
The dense-fast case has the largest CPU increase. An initial three-pair capture
and diagnostic profiles are retained separately from this final five-pair result.

All fourteen production client resources are byte-identical: 302,311 bytes raw
and 129,919 bytes with level-1 gzip. The stripped Go server grows from 13,308,064
to 13,324,448 bytes raw, an increase of 16,384 bytes. Level-1 gzip grows from
6,170,226 to 6,176,117 bytes, an increase of 5,891 bytes. The comparison uses the
exact previously accepted baseline binary and the same toolchain, PGO input,
stripping, and compression settings.

The final build, lint, custom Go formatting, and diff checks pass. The complete
test suite passes all 68 client/integration/parity entries and all Go packages.
The final checked replay confirms identical results for all 46 course cases
after the route/predictor cleanup. Production AI files remain below 500 lines.

The [saved evidence](../../../benchmarking/experiments/2026-10-20/npc-pursuit/)
contains frozen source, fixture provenance, per-case metrics, raw logs, and
reproduction instructions, final CPU and resource captures, and exact source
identity.
