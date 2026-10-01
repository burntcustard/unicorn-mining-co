# Elapsed-time server updates — 2026-09-27

The server now retains elapsed simulation time when an update runs late. A
100 ms callback advances three nominal ticks instead of slowing gameplay to
one third speed. Clients keep predicting between the less frequent snapshots.
The normal 30 Hz path remains approximately the same CPU cost in local tests.

## What was causing slowdown

The server timer explicitly dropped overdue time after each callback. Separately,
the client stopped predicting two ticks beyond the latest server snapshot, even
if its rendering loop was healthy. Browser frame deltas were also capped at
1/15 second, losing elapsed time below 15 FPS.

## Implementation

- The server uses a monotonic deadline to count elapsed whole 1/30-second ticks.
  Fractional time and unpaid whole ticks stay on that clock.
- One callback advances up to `maxCatchUpTicks` (six, or 200 ms). Longer stalls
  are repaid over subsequent callbacks, yielding at least 1 ms between them.
- Movement retains its existing small integration steps. Region synchronization,
  collision detection, contact handling and replication run once for the batch.
  Collision detection sweeps the complete batch's movement using the existing CCD.
- Queued control changes from every elapsed tick retain their within-tick timing.
  Future inputs remain queued. Replication and cleanup schedules detect crossed
  deadlines instead of relying on landing on a particular tick remainder.
- Client prediction estimates the progressing server clock between snapshots.
  Prediction, reconciliation replay and browser frame catch-up have a shared
  `maxPredictionTicks` limit of 15 ticks (500 ms).
- Remote interpolation adapts to the received snapshot cadence, including when
  the stationary local ship is omitted from a delta packet.
- During browser frame catch-up, snapshots are applied only at a simulation
  boundary at or after their reception time. Applying a fresh snapshot at an
  earlier boundary double-counted elapsed time; the 10 FPS regression test
  exposed this and now covers the fix.

Both bounds are in `src/shared/settings.ts`. No protocol fields or deployment
settings changed. At 30 Hz, the server still advances one normal tick.

This is bounded elapsed-time catch-up, not one arbitrarily large integration
step or multiple complete server updates for every missed deadline.

## Three-player correctness and rendering checks

`npm run test:server` includes the new `tests/server-lag.test.ts`:

| Server interval | Client interval | Server ticks in 30 seconds | Paused local / remote frames |
| --------------- | --------------- | -------------------------: | ---------------------------: |
| 33.33 ms        | 16.67 ms        |                        900 |                        0 / 0 |
| 100 ms          | 16.67 ms        |                        900 |                        0 / 0 |
| 200 ms          | 16.67 ms        |                        900 |                        0 / 0 |
| 100 ms          | 100 ms          |                        900 |                        0 / 0 |

These use the real session, input parsing, serialization, replication and client
prediction with a virtual clock. Region loading is disabled to isolate clock
behavior from random contacts. Each ship travels 3,000 world units on the server
at 100 units/second. Every client measures 3,003.379 units including its initial
prediction lead, independent of update cadence. Maximum rendered movement after
warm-up is 1.667 units per 60 FPS frame, or 10 units per 10 FPS frame.

Other regressions cover a one-second server stall followed by sustained 100 ms
callbacks, a two-second packet outage, timed thrust/turn edges in later batch
ticks, retained future inputs, skipped distant-replication deadlines and a
500-unit/second body's 100 ms sweep against a thin wall without tunneling.

A real Chrome smoke test used three isolated browser contexts, the development
server and Vite, and a test-only timer wrapper delaying short server timers to
100 ms. During 15 seconds of thrust:

| Client | Rendered frames | p95 frame interval | Snapshots | Server ticks advanced |
| ------ | --------------: | -----------------: | --------: | --------------------: |
| 1      |             901 |            19.6 ms |       148 |                   448 |
| 2      |             900 |            20.2 ms |       147 |                   445 |
| 3      |             901 |            20.0 ms |       147 |                   445 |

All three rendered approximately 60 FPS and reported no runtime exceptions.
Snapshot tick jumps were three or four. Counts span the first to last received
snapshot, not exactly the full 15 seconds. The wrapper simulates slow scheduling;
it does not consume 100 ms of CPU. This was local Chrome, not a Fly measurement
or a Firefox test. All launched test services and browser processes were stopped.

## CPU measurements

Node 26.8.2 on Ryzen 7 5800X3D, production-minified flight bundles, three players,
16 MiB semi-space. Each invocation runs a warm session then a measured session:
300 warm-up plus 1,800 measured logical ticks per session. Three repeats for each
of three routes and four variants: 36 measured runs, sequential and alternating
order. Each invocation simulates 140 seconds in total and has a 290-second wall
timeout. No individual test ran longer than five minutes.

Median process CPU milliseconds **per callback**:

| Route   | Before, 33 ms | After, 33 ms | After, 100 ms / 3 ticks | After, 200 ms / 6 ticks |
| ------- | ------------: | -----------: | ----------------------: | ----------------------: |
| Spread  |         0.656 |        0.661 |                   0.777 |                   1.791 |
| Convoy  |         0.437 |        0.448 |                   0.885 |                   1.667 |
| Contact |         0.584 |        0.546 |                   0.541 |                   0.780 |

Sum of route medians at normal cadence changes by **-1.3%**, which is best treated
as approximately unchanged: individual routes range from -6.5% to +2.5%.
Normal before/after runs finish with identical positions and entity counts.

Across these routes, a 100 ms callback costs **33% more CPU than a new normal
callback**, while advancing three times as much game time and sending one third
as many snapshots. A 200 ms callback costs about 2.56 times as much. These results
do not show the feared threefold CPU cost per real-time second.

Normalized per simulated second, measured CPU is 56% lower for three-tick batches
and 58% lower for six-tick batches than before. **Those are not clean optimization
claims:** less frequent contact resolution changes the flight paths and active
entity populations. For example, spread ends with 199 entities in both normal
variants, 80 with three-tick batches and 155 with six-tick batches. Coarser
collisions plus fewer replication/region passes both contribute to the results.
A busy Fly instance can have different costs.

Median p95 wall time per callback:

| Route   |   Before |    After |  3 ticks |  6 ticks |
| ------- | -------: | -------: | -------: | -------: |
| Spread  | 0.984 ms | 0.967 ms | 1.154 ms | 2.565 ms |
| Convoy  | 0.656 ms | 0.663 ms | 1.269 ms | 2.656 ms |
| Contact | 0.862 ms | 0.837 ms | 0.808 ms | 1.100 ms |

Raw runs, virtual-clock results, browser measurements and bundle sizes are in
[`benchmarking/results/2026-09-27-elapsed-time.json`](../../benchmarking/results/2026-09-27-elapsed-time.json).
The flight harness now accepts `--batch-ticks=1|2|3|6`; see its README for units.

## Limits and validation

During overload, collision/contact results can differ from 30 Hz: turning paths,
sustained contacts, docking and mining are evaluated less often. The thin-wall
sweep regression validates one important case, not every collision configuration.
The change preserves real-time movement; it cannot hide delayed information about
other players or eliminate corrections at contacts.

The 200 ms server batch and 500 ms prediction horizon bound individual work and
speculation. If processing continuously costs more than the maximum batch can
advance, simulation debt still grows. If packets disappear beyond the prediction
horizon, clients stop extrapolating and later reconcile. Infinite overload cannot
be solved by changing the clock.

Build, lint, server/lag, simulation/snapshot, prediction, collision, packet and
reconnection tests pass. The existing normal-rate prediction test reports 600
predicted ticks with zero corrections. Browser smoke testing passes as above.

| Resource     | Raw before → after | gzip level 1 before → after |
| ------------ | -----------------: | --------------------------: |
| Main client  |  96,688 → 96,988 B |           42,964 → 43,100 B |
| Server       |  81,210 → 81,470 B |           35,018 → 35,202 B |
| Docked chunk |    4,740 → 4,740 B |             2,446 → 2,446 B |
| Sound chunk  |    1,681 → 1,681 B |                 942 → 942 B |
