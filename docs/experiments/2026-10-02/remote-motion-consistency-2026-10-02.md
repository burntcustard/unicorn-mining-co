# Remote motion and collision consistency — 2026-10-02

This pass starts from the completed remote-movement follow-up, including its
outage guard. The goal is smoother motion with small source changes and a hard
20% server CPU limit. The baseline is the starting working tree, rather than
repository HEAD, which does not include the preceding presentation fixes.

## Retained changes

Both servers emit an ID-only entity record when a scheduled, undocked player
ship has no changed fields. The existing binary format already supports zero
fields, so this adds no protocol field or version. For small IDs, an unchanged
ship costs two bytes per snapshot. The shared snapshot batch caches that fragment
across receivers. Changed ships retain their usual deltas, and docked ships
retain ordinary omission. Stations and asteroids keep their sampling schedules.
Stationary ships therefore receive explicit authoritative samples; their
client playback clocks continue through stationary periods and resume movement
on the ordinary timeline. Synthetic samples still cover omitted scenery and
skipped slow-tier ticks.

The Go regression exercises real Mustang instances. They embed the base Ship,
so detecting ships uses the promoted `ShipBase()` interface rather than a
concrete base-type assertion. Both codecs test 90 unchanged ticks, ID-only
records, fragment reuse and docked omission.

Remote interpolation uses velocities and spin already present in snapshots.
Monotone cubic Hermite tangents replace straight-line segments when motion is
known. Each tangent is restricted to zero through three times its coordinate's
endpoint difference; a constant coordinate stays constant. Positions stay
inside their endpoint bounds, and the renderer still holds the last known pose
when packets stop. Missing or zero motion retains linear interpolation.
This removes the artificial change of speed at every snapshot during smooth
acceleration and turning without adding a playback tick.

A remaining isolated peak traced to fractional contact prediction between
display frames. Solving the same contact with a different partial timestep can
switch its positional projection. Frame prediction now computes the unfinished
tick's full physics endpoint and draws all copied bodies between their common
checkpoint and endpoint with the same bounded Hermite helper. Exact full-tick
endpoints bypass interpolation. Both touching hulls use the same fraction;
input prediction still reacts on the current frame and committed physics is
unchanged. The path within an unfinished tick is a presentation approximation;
it does not replay its individual impact and rebound segments.

This reuses the existing checkpoint poses rather than cloning another set of
starting vectors. Its full endpoint is cached until the checkpoint, held input
or last timed input transition changes. Repeated display samples restore that
endpoint rather than rerunning the same physics. The shared interpolation helper remains a static first-frame
import. No server-side physics change or extra playback tick is introduced.

Position corrections use a critically damped release, carrying their release
velocity through subsequent reconciliations. With offset `e`, release velocity
`v`, rate `k = 1 / simulationStep` and elapsed seconds `t`, the remaining offset
is `(e + (v + k * e) * t) * exp(-k * t)`. An isolated correction starts with
zero release velocity and releases approximately 80% by 100 ms and 95% by
158 ms. Reconciliation without a new mechanical error follows the same release
as an uninterrupted correction, rather than restarting its easing on every
snapshot. The carried velocity is bounded toward zero per coordinate, so a
changed correction cannot overshoot its new physical pose.

Heading corrections retain the existing faster exponential release. Slowing
them caused a short-turn regression to briefly rotate backwards after turning
stopped, so that change was rejected. Input prediction and collision mechanics
still update immediately. Docking, teleports and unloaded objects retain their
resets. These are visual offsets, not another snapshot buffer.

The production source change is **137 net client/shared lines, six TypeScript server
lines and three Go server lines** relative to this pass's baseline. The
copied contact neighbourhood is unchanged.

## Iteration and regression checks

A shared playback-clock prototype passed the ordinary motion checks but changed
the required behavior of sparse distant objects. Predicting all remote ships
through full fractional physics made whole-scene motion rougher, especially at
144 Hz. Neither prototype is retained.

A nine-variant screen compares contact widths of 3, 4 and 6 times the pose
separation, and correction release rates of 1, 1.5 and 2 simulation-step units.
All variants use four clients, three bidirectional delivery profiles, and 60/144
Hz displays. The existing width of three and release rate of one produce the
lowest summed whole-scene roughness for that initial easing candidate. A wider band reduces isolated pass-by
speed surges but loses in the combined collision scene, so the original band
and copied contact neighbourhood are retained.
[Raw screen](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-screen.json.gz).

A further three-rate screen keeps that contact width and tests the final
velocity-preserving release. Rate one again has the lowest summed roughness;
rates 1.5 and 2 settle faster but add more visible acceleration during collisions.
[Final release screen](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-critical-screen.json.gz)
preserves its sources and hashes. The
[initial easing candidate](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-easing-candidate.json.gz)
preserves the preceding full comparison, including its rejected slower heading
release.

The trajectory regression has an analytic reference for constant linear and
angular acceleration at 30, 60 and 144 Hz. It separately checks that extreme
velocity reversals remain inside the known endpoints and never move backwards
through a known forward segment. The correction regression checks continuity,
no initial artificial velocity kick, bounded settling, uninterrupted release
through repeated reconciliation, no overshoot after correction reversal, and
unchanged mechanics.
Existing delayed collision, stationary restart, packet burst and outage tests
continue to run.

The new contact regression starts from an overlapping hull and samples the first
microsecond of the unfinished tick. It verifies continuous presentation and an
unchanged committed endpoint. It fails with the original fractional solver and
passes with the retained endpoint approach. A straight-line endpoint prototype
also reduced the traced 32-player peak; Hermite endpoints improve all six
four-player scene RMS values and preserve smooth acceleration, so they are
retained.

## Final replay and browser results

The final comparison runs three independent processes per version. Every run
repeats deterministically. The final endpoint iteration reuses the three
completed baseline runs and performs three fresh after runs. Workload fixture
hashes must match before reuse; the archive records its parent and hash.
It covers 120 pass-by cases, 20 playback-clock cases,
12 accelerating trajectories and 24 collision scenes per version/run: **1,056
cases** overall. Collision scenes have 4, 8, 16 or 32 real network clients,
60/144 Hz displays, and steady, jittered or burst delivery in both directions.
Each scene runs six simulated seconds; statistics exclude the first second.
Every client observes every other player.

Movement roughness is the RMS change in consecutive display-frame displacement,
measured across all observers and peers. Lower values mean less variation in
displayed velocity. Every one of the 24 scene comparisons improves:

| Players | RMS roughness improvement across six scenes |
| ------: | ------------------------------------------: |
|       4 |                                   6.1–28.8% |
|       8 |                                   5.2–18.8% |
|      16 |                                   2.4–11.3% |
|      32 |                                   1.2–11.7% |

Physical collision-tick counts and final authoritative positions and velocities
match exactly. Packet receipt produces zero instantaneous position jump;
snapshot application remains below 0.000001 world units. The constant-speed
clock and pass-by results are unchanged. The latter retains a maximum speed
ratio of 1.4943 and frame speed change of 0.09074, rather than worsening the
handoff to collision prediction. Analytic acceleration errors fall from
0.018629 world units to below 0.000000000005, and from 0.00005554 radians to
below 0.00000000000002.
[Final source and replay archive](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency.json.gz).

The isolated 32-player/144 Hz steady-delivery peak falls from 4.7231 in the
baseline to 4.0695 world units of frame-displacement change. The earlier
correction-only candidate reached 5.3171; tracing that event led to the fixed
endpoint change. Peak reductions are not uniform: the eight-player/60 Hz burst
case changes from 5.8154 to 5.8232 (+0.14%), while its RMS improves 5.2%.
[Correction-only candidate](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-critical-candidate.json.gz),
[peak trace](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-peak.json.gz),
[straight endpoint prototype](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-endpoints.json.gz)
and [Hermite endpoint prototype](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-hermite-endpoints.json.gz)
preserve the intermediate evidence.

The four-browser capture uses Chrome 154, the actual development canvas renderer,
the standard server/proxy, and 40/55/70/85 ms delay in each direction. Every
browser sees the other three ships; all free-flight packet and snapshot position jumps are
zero. With replay processes finished, the clients average 59.84–60.00 FPS and
95th-percentile display intervals of 16.7–16.8 ms. Individual intervals still
reach 50 ms; this is not a guarantee against browser or machine stalls.
[Browser capture](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-browser.json.gz).
Owned servers, browser processes and debug ports are cleaned up afterward.
The capture distinguishes deliberate docking resets using successive received
states, rather than an already-updated client world. A prior capture reported
a docking snap of about 200 units as a free-flight jump because its classifier
used the latter; production docking continues to reset presentation immediately.

## Server CPU

Both versions use the same workload and production compilation settings, with
alternating process order and three repetitions at 4, 8, 16 and 32 players.
Timing runs are sequential, pinned to CPUs 0 and 1, with builds, other replays
and browser captures outside timing. These are process CPU measurements on the
local Ryzen 7 5800X3D, rather than wall-clock timing or Fly.io measurements.

Go uses the existing production PGO, `GOEXPERIMENT=simd`, `GOGC=800`,
`GOMAXPROCS=2`, 120 warmup ticks and 3,000 measured ticks. Convoy, spread, contact,
module and stationary workloads comprise 120 measured processes. The comparison
requires identical contacts, events, packets, entities and final states; only
wire byte totals may differ. Compared physical states match exactly.

| Players | Largest scenario CPU increase | Stationary CPU increase |
| ------: | ----------------------------: | ----------------------: |
|       4 |                         2.84% |                   1.37% |
|       8 |                         2.03% |                   1.52% |
|      16 |                         4.60% |                   4.60% |
|      32 |                         7.10% |                   7.10% |

Aggregate Go CPU increases **0.58%**, calculated from the sums of scenario
medians. Every measured scenario is below the 20% limit. The largest stationary
case changes from 0.132471 to 0.141878 ms CPU/tick. Packet counts and physics are
unchanged; byte totals reflect the extra heartbeat records.
[Raw Go CPU results](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-go-cpu.json.gz)
retain every measurement, executable hashes and the PGO hash.

The production Node comparison uses the existing warmed flight harness at the
same four player counts, three alternating repetitions, 900 measured ticks,
and the same 16 MiB semi-space setting. It checks final positions, entity counts
and packet counts while permitting changed wire bytes. Stationary Node ships
are measured separately with thrust and turn disabled. Across active and
stationary scenario medians, Node CPU changes by -0.03%, within measurement
noise. The largest scenario increase is **12.44%** at 32 stationary ships,
from 0.936679 to 1.053199 ms CPU/tick. Every scenario remains below 20%.
[Active Node measurements](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-node-cpu.json.gz)
and [stationary Node measurements](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency-node-idle.json.gz)
preserve all 120 processes and executable hashes.

The arithmetic means also satisfy the budget: aggregate Go CPU changes by
+0.52%, with a largest scenario increase of 7.33%; aggregate Node CPU changes
by -0.05%, with a largest scenario increase of 10.16%. Both harnesses measure
simulation, snapshot construction and queued socket sends with stub sockets.
They do not time operating-system network writes or TLS. The four-browser
capture separately exercises real WebSockets but is outside CPU timing.

## Reproduction

The final replay archive contains the complete before/after source and hashes.
Its baseline can be replayed without reverting the working tree:

```sh
REMOTE_SAME_PHYSICS=1 node benchmarking/tools/remote-smoothness.mjs \
  benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-remote-consistency.json.gz \
  /tmp/remote-consistency-recheck.json.gz
```

For CPU, compile the baseline with a Go source overlay replacing only
`internal/server/binary-replication.go`, and compile the after executable from
the current checkout, both with `-pgo=cmd/go-server/default.pgo`. Then run:

```sh
BEFORE_GOGC=800 AFTER_GOGC=800 GOMAXPROCS=2 CPU_AFFINITY=0,1 \
  REPETITIONS=3 TICKS=3000 WORKLOADS=convoy,spread,contact,module,idle \
  OUTCOME_COMPARISON=replication node benchmarking/tools/go-cpu-paired.ts \
  remote-consistency /tmp/unicorn-consistency-before /tmp/unicorn-consistency-after
```

The test fixture keeps the same physics and input schedule between executables.
The `replication` comparison requires every usual outcome except byte totals to
match. It does not skip physical-state validation.

The final release screen can also be repeated without modifying the checkout:

```sh
REMOTE_SCREEN_WIDTHS=3 node benchmarking/tools/remote-consistency-screen.mjs \
  /tmp/remote-consistency-critical-screen.json.gz
```

## Validation and size

The production build, complete `npm test`, type-aware lint, all Go packages,
Go snapshot decoding and Go/Node session comparison pass. The session comparison
matches 748 decoded packets, including timed input, reconnection, catch-up and
backpressure. Lint retains two existing `no-new-array` warnings. Go formatting
and changed-file formatting pass; the full formatting check flags the same six
pre-existing experiment reports, which this pass does not edit.

Production JavaScript sizes use Node's gzip level 1, matching the build plugin:

| Resource     | Before raw | After raw | Before gzip | After gzip | Gzip change |
| ------------ | ---------: | --------: | ----------: | ---------: | ----------: |
| Main client  |  121,973 B | 122,869 B |    53,612 B |   54,039 B |      +427 B |
| Node server  |  105,968 B | 106,049 B |    45,504 B |   45,501 B |        -3 B |
| Docked chunk |    4,708 B |   4,708 B |     2,432 B |    2,430 B |        -2 B |
| Sound chunk  |    1,681 B |   1,681 B |       942 B |      942 B |         0 B |
