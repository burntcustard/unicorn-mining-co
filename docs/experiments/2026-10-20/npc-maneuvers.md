# NPC circle navigation and maneuvers — 20 October 2026

NPC navigation now uses obstacle radii. Acceleration-based corner steering,
coasting through turns, opposing-engine braking, and shorter momentum-aware
flybys improve pursuit without changing ship physics or maximum speed.
The clearance distance decreases from 3 to 1 unit; decisions remain at 0.2 seconds,
response time at 0.5 seconds, and prediction time at 2 seconds.

Across 20 five-minute curving chases, accumulated excess lag decreases by about
26% and time more than 700 units behind decreases by about 66%. Individual
courses can still regress; this is an aggregate improvement, rather than a claim
that every chase becomes faster. The build, lint, full test suite, and custom Go
formatting checks pass.

## Navigation and movement

Asteroids, stations, jump gates, uncollectable items, and the pursued ship use
circles in route and avoidance calculations. Mining, polygon vertex counts, and
rotation no longer change their navigation geometry. Swept relative circle
checks still detect crossings between forecast samples. The NPC's own navigation
radius encloses its physical fixtures, excluding decorative and pickup geometry.

Actual collisions and line-of-sight retain their existing geometry. These are
separate questions: a pirate can see through a drilled opening while choosing a
route around the asteroid's radius. Docking retains its designated approach
corridor. No polygon fallback remains in obstacle navigation.
Circle records contain only numbers, so three old buffer-clearing passes and a
redundant route-distance calculation were removed as part of the cleanup.

The retained maneuvers address measured failures:

- At a detour corner, steer toward the acceleration needed to cancel lateral
  velocity and enter the new course. Previously, a ship could keep thrusting
  while its momentum carried it away from the waypoint.
- Reduce engine power by its alignment with that acceleration during detour
  turns. A backward-facing engine coasts through the turn; an aligned engine
  returns to full power. This does not impose a lower cruising speed.
- For arrival, bound detour thrust by the stopping envelope of the actual
  player. A distant route waypoint previously bypassed the arrival controller
  even when the player was already close.
- When closing too fast, rotate toward the braking acceleration and use the
  ordinary main engine against excess relative momentum. Limit the final impulse
  to avoid reversing relative velocity in one held decision.
- Pick a flyby's side from lateral relative velocity and derive its lateral
  offset from turning radius and held-input travel. This replaces longer,
  one-sided passes that spent unnecessary time out of shooting position.

The approach regression reproduces the old near-collision with a player 1,000
units away and a radius-90 asteroid near the final approach. Four mirrored cases
must remain at least 190 units apart and settle within 20 units of the requested
220-unit distance. Opposing-engine braking also runs with initial headings
toward, across, and away from the player. These use ordinary ship controls and
the actual movement/collision solver.

## Investigation and rejected alternatives

The steering research considered predictive pursuit, offset pursuit, force-based
arrival, obstacle approximation, turning time, and active braking. Reynolds'
[steering paper](https://www.red3d.com/cwr/steer/gdc99/) separates high-level
steering from locomotion and describes bounding spheres for avoidance, predicted
pursuit, and offset pursuit. [Endless Sky's AI](https://github.com/endless-sky/endless-sky/blob/master/source/AI.cpp)
and [Naev's AI](https://github.com/naev/naev/blob/main/src/ai.c) provide examples
of accounting for turn time and stopping motion in spacecraft control. The
implementation here uses this game's existing physics; no code or dependency
was imported from those projects.

Tracing the two initially regressing circle-only chases found no empty blocked
routes in 1,500 decisions per course. The relevant failures began with brief
corners where velocity faced away from the next waypoint, followed by long
maximum-speed recovery. A 204-unit/second pursuer gains only about 14 units/second
on a 190-unit/second target. Avoidance sometimes reversed a requested turn or
replaced coasting with thrust at the start of these escapes.

The comparison included:

- Clearance distances 3, 2, and 1. Reducing clearance alone had mixed results;
  the retained value is paired with the corner controller, not treated as a
  substitute for handling momentum.
- Facing the requested acceleration at corners, with full power, projected
  acceleration throttle, or alignment-based throttle. Alignment-based throttle
  gave the retained combination of pursuit performance and narrow-gap behavior.
- Predicting the player's future position behind an obstacle from observed
  velocity/acceleration, clipping that prediction at solid space. Both a full
  prediction horizon and a shorter response-time horizon regressed some point
  courses. These speculative interception helpers were removed.
- Penalizing final facing direction in avoidance, including weaker and
  reverse-facing-only penalties. Some curving chases improved, but a usable
  narrow gap became too slow or another chase failed. These penalties were not
  retained.
- Finer circle-gap routing. The traces showed valid, reasonably direct routes,
  so additional routing state and nodes were not justified by the failures.

No target-heading guess or committed interception tactic was added. The retained
controller responds to observed movement and preserves existing route commitment.

## Pursuit comparison

The paired runs use identical final fixtures for the previous production
controller and the new controller. Historical polygon-recess courses cannot
serve as a fair radius-only comparison: some reference paths pass through space
inside an obstacle's circle. The updated reference generator uses circles and
a 44-unit envelope around its center, sufficient for the Courser's navigation
radius and either tested clearance value. Two straight-gap seeds changed because
the old geometry had no suitable circle-compatible corridor. Numeric acceptance
budgets were retained.

The kinematic reference follows an independent grid-derived, rounded route.
Its speed, acceleration, and yaw are bounded, although force direction can change
abruptly at straight/curve joins. The "physical player" variant adds a real
colliding player ship following that prescribed reference; it does not derive
the reference from a human player's engine inputs. Additional continuous orbits
have smoothly changing force within an ordinary Courser's engine limits.

| Comparison                                            |                Before |                 After |
| ----------------------------------------------------- | --------------------: | --------------------: |
| Excess lag integral over 300 units, 20 curving chases | 94,227.9 unit-seconds | 69,894.6 unit-seconds |
| Time beyond 700 units, same chases                    |         75.63 seconds |         25.39 seconds |

The final replay includes seven spinning generated fields, six permanent curving
chases, fourteen additional curving chases, three continuous orbits, and three
35-second straight-gap courses. That is 150 simulated minutes of five-minute
courses plus the straight-gap checks per controller. All required courses pass.
Raw per-case lag, contacts, and stationary metrics are retained with the
[quality evidence](../../../benchmarking/experiments/2026-10-20/npc-maneuvers/quality/).

## Combat CPU comparison

The five-case whole-session benchmark uses **2.82% less process CPU** in aggregate
than the already optimized implementation at the start of this task. This is an
additional comparison, separate from the previous
[pirate CPU investigation](pirate-cpu.md). It is not a measurement of navigation
alone and should not be added to that report's percentage.

Each entry is the median of five alternating before/after runs with 9,000 timed
ticks per run and case. The aggregate compares sums of case medians, giving each
case the same number of simulated ticks.

| Scenario                           | Before, microseconds CPU/tick | After, microseconds CPU/tick | CPU reduction |
| ---------------------------------- | ----------------------------: | ---------------------------: | ------------: |
| Open space                         |                        19.424 |                       20.460 |        -5.33% |
| Normal asteroid field              |                        39.984 |                       34.347 |        14.10% |
| Dense asteroid field               |                        55.168 |                       52.398 |         5.02% |
| Normal field, full-throttle player |                        44.184 |                       44.034 |         0.34% |
| Dense field, full-throttle player  |                        58.074 |                       59.488 |        -2.43% |

Ship controls and movement changed, so the before/after trajectories differ.
All workload checks pass: both fast players average about 192 and 180 units/second,
remain in the asteroid field throughout, and both variants fire weapons in every
case. In the normal fast case, fighting increases from 91.3% to 100% of measured
ticks and maximum separation improves from 1,199 to 833 units. Dense-fast
maximum separation improves from 697 to 628 units. Two cases have
higher CPU cost; the aggregate gain does not imply improvement in every field.

A preceding capture before removing the three redundant buffer clears measured
a 4.48% aggregate reduction. Its source and samples are retained as a separate
[initial checkpoint](../../../benchmarking/experiments/2026-10-20/npc-maneuvers/checkpoints/initial-accepted/).
The movement metrics are identical between these checkpoints. The final table
uses the final source; the differing CPU samples support treating the overall
gain as modest and approximate.

The benchmark includes one real player, one fighting pirate, session input,
generated fields, weapons, physics, and snapshots. Process user plus system CPU
excludes world construction, warmup, binary control decoding, TCP, and timers.
Both binaries use Go 1.27.1, `GOEXPERIMENT=simd`, the same production PGO input,
production `GOGC=800`, and automatic Go scheduling. Builds, tests, profiling,
and compression were excluded from the sequential measurement window.

The [saved evidence](../../../benchmarking/experiments/2026-10-20/npc-maneuvers/)
contains all samples, activity metrics, source snapshots, and reproduction notes.

## Pirate dialog

The cargo-demand timeline is now:

| Since demand            | Event                                        |
| ----------------------- | -------------------------------------------- |
| 0 seconds               | Cargo request and release-cargo chat control |
| 10–14 seconds           | `5`, `4`, `3`, `2`, `1`                      |
| 17 seconds              | `...`                                        |
| 20 seconds              | Random attack announcement                   |
| 23 seconds              | Combat can begin                             |
| 83 seconds              | First taunt, if combat remains active        |
| Each further 60 seconds | Another taunt                                |

The taunt alternatives are `Come back here!`, `I'm going to get you!`, and
`You can't run from me!`. The server chooses once and broadcasts the same text
to clients. Target changes and temporary loss of sight preserve the combat clock;
an overdue taunt waits for a visible enemy. Surrender and escape reset it when
combat ends. Existing immediate retaliation remains immediate when no attack
announcement was made, and a hit during an announced pause cannot bypass it.

Regression tests cover canceled pauses after surrender/docking, continued pauses
for another existing attacker, duplicate announcements, minute boundaries,
visibility changes, and consistent speech across clients.

## Validation and resource sizes

`npm run build` passed before and after. `npm run lint`, the full
`npm run test -- --skip-build` suite, and the custom Go formatting check passed.
The full suite includes server, client, integration, parity, and NPC regressions.

The 14 production client resources are byte-identical: 302,311 bytes raw and
129,919 bytes with the same level-1 gzip measurement. The stripped Go server
remains 13,308,064 bytes raw; level-1 gzip decreases from 6,171,397 to 6,170,226
bytes, a 1,171-byte decrease. Go, PGO input, and compression settings are held
constant for this comparison. No dependencies were added.
