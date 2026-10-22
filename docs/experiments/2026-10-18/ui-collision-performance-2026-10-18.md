# UI and collision performance — October 18, 2026

> Evidence for this completed investigation is in the
> [2026-10-18 archive](../../../benchmarking/archive/README.md#2026-10-18).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-18`.

The [follow-up](performance-fixes-2026-10-18.md) records local recovery and HUD
optimizations made after this initial investigation. The measurements below
describe the original three-commit comparison and unmodified live deployment.

The three-commit comparison found a serious server regression in dense module
collisions. At 32 players, median process CPU rose from **1.251 to 17.439 ms per
tick**, allocation rose from **0.284 to 8.452 MB per tick**, and elapsed tick p95
rose from **1.902 to 103.070 ms**. CPU and allocation profiles identify the new
overlap-recovery routine as the dominant cost. The tested revision included no
fix; the working-tree changes at that point repaired benchmark runners and
retained evidence.

The fresh live rerun completed all 16 cases with no client exceptions or socket
closes. Observed tick cadence remained approximately 30 Hz and deployment health
checks passed. High-player latency and frame-rate results were affected by local
software rendering and CPU saturation, so they cannot clear the server CPU
regression. Live measurements and deployment observations are recorded in
[live results](../../../benchmarking/live/results.md#october-18-2026-at-54430-pm-gmt1).

## Comparison and method

- Before: `13ff7a0e0375bcd53f04a29f77003d7599338cbb`.
- Current: `94969b94d40bc30bf780c7da6db5e49d231cb720`.
- Commits included: `cdef51b`, `3a5ac74`, and `94969b9`.
- Host: Intel Core Ultra X7 358H, 16 logical CPUs. CPU captures ran sequentially
  on CPUs 0/1 with `GOMAXPROCS=2`, `GOGC=200`, and `GOMEMLIMIT=off`.
- Both server test executables used Go 1.27.1, `CGO_ENABLED=0`,
  `GOEXPERIMENT=simd`, and the corresponding `src/server/default.pgo` profile.
- Each server case used seed 25, 120 warmup ticks, 1,800 measured ticks, and three
  before/after pairs, alternating execution order: **96 captures in total**.
- CPU is process user plus system time divided by measured ticks, including
  automatic garbage collection. The table reports medians of three captures.
  Elapsed p95 is the median of each capture's tick p95.
- The server fixture uses in-memory socket sinks and no SQLite writes. It measures
  simulation and replication cost without production networking or persistence.
- Outcome comparison used `report`, since the commits change gameplay, geometry,
  replication, and resulting entities/events. These are whole-revision workload
  comparisons, not behavior-preserving optimization comparisons.

No local client benchmark was repeated after the user's live-only rerun request.
The client section below summarizes captures already completed earlier that day.
All builds finished before measured sessions; no browser capture or build ran
concurrently with the server CPU measurements.

## Server CPU results

| Players | Workload | Before CPU ms/tick | Current CPU ms/tick | Change   |
| ------- | -------- | ------------------ | ------------------- | -------- |
| 4       | Convoy   | 0.0661             | 0.0797              | +20.6%   |
| 4       | Spread   | 0.0946             | 0.1261              | +33.3%   |
| 4       | Contact  | 0.0687             | 0.0763              | +11.1%   |
| 4       | Module   | 0.1255             | 0.4103              | +227.1%  |
| 8       | Convoy   | 0.0997             | 0.1316              | +32.0%   |
| 8       | Spread   | 0.1455             | 0.2131              | +46.5%   |
| 8       | Contact  | 0.1005             | 0.1078              | +7.2%    |
| 8       | Module   | 0.2516             | 1.3537              | +438.1%  |
| 16      | Convoy   | 0.1936             | 0.2448              | +26.5%   |
| 16      | Spread   | 0.2428             | 0.3582              | +47.5%   |
| 16      | Contact  | 0.1472             | 0.1827              | +24.1%   |
| 16      | Module   | 0.4769             | 3.7837              | +693.4%  |
| 32      | Convoy   | 0.3930             | 0.6794              | +72.9%   |
| 32      | Spread   | 0.3724             | 0.5071              | +36.2%   |
| 32      | Contact  | 0.2535             | 0.3187              | +25.7%   |
| 32      | Module   | 1.2512             | 17.4392             | +1293.8% |

The three current 32-player module CPU measurements were 17.436, 17.441, and
17.439 ms/tick. The before measurements were 1.251, 1.249, and 1.265 ms/tick.
The increase is repeatable and substantially larger than capture variation.

| Module players | Before elapsed p95 ms | Current elapsed p95 ms | Before allocated B/tick | Current allocated B/tick |
| -------------- | --------------------- | ---------------------- | ----------------------- | ------------------------ |
| 4              | 0.234                 | 1.616                  | 34,108                  | 160,088                  |
| 8              | 0.419                 | 8.140                  | 67,454                  | 621,229                  |
| 16             | 0.755                 | 19.783                 | 111,422                 | 1,737,676                |
| 32             | 1.902                 | 103.070                | 283,975                 | 8,451,542                |

At 30 Hz the elapsed tick budget is 33.33 ms. The 32-player module p95 exceeds
that budget by about three times on this host. Process CPU and elapsed duration
are distinct measurements: the 17.439 ms CPU average does not imply that every
tick finishes within budget. Median peak RSS rose from 72.4 to 126.5 MiB in this
case. This short local capture does not establish production memory headroom or
long-term retention.

## Collision regression attribution

The current 32-player module CPU profile attributes **83.49% cumulative CPU**
to `World.recoverOverlaps`, including **64.78% self CPU**. Its helper
`recoveryProject` accounts for another 5.95% self CPU within that cumulative
total. The allocation profile attributes **95.11% of sampled allocated bytes**
to recovery and its callees, including 14.60% to `recoveryAxes`. The allocation
profile includes test setup and warmup; the CPU profile covers measured ticks.
These percentages are supporting profiles, not samples from the unprofiled
three-pair comparison above.

The source path is
[overlap-recovery.go](../../../src/server/physics/overlap-recovery.go).
Every nonzero physics step calls recovery. It identifies deeply embedded bodies
from contacts, then, for each such body:

1. Scans **every other body** and every eligible fixture pair, including distant
   obstacles, without using the existing spatial broad phase.
2. Rebuilds polygon axes and projection slabs for those pairs, allocating slices.
3. Searches at least 16 directions, plus normals from containing slabs; every
   direction visits the obstacle slabs and allocates/sorts escape intervals.

This couples the cost of resolving one embedded body to unrelated geometry
throughout the active physics world. More simultaneous embedded bodies and more
fixtures multiply that work. Repeated axes, slabs, and interval allocations add
garbage collection pressure. The profile supports this mechanism directly; a
single big-O label would obscure the changing fixture and direction counts.

A separately compiled diagnostic overlay removed only the call to recovery.
No tracked product source was edited. Three additional 32-player module captures
then measured **1.443 ms CPU/tick**, **352,270 allocated B/tick**, and **2.221 ms
elapsed p95**, using the current revision's other features. This is strong
support for recovery being the principal regression. Removing recovery changes
collision trajectories, entity counts, and outcomes, so it is not a valid fix
or an exact measurement of the routine's isolated cost. The saved
[diagnostic patch](../../../benchmarking/archive/README.md#2026-10-18)
is for attribution only.

The next implementation should preserve compound-hull escape behavior while
bounding obstacle work with a conservative spatial query and a proven escape
bound, then reuse axes/projection/interval storage. Limiting candidates to
currently touching fixtures alone is unsafe: an escape can enter neighboring
geometry. Correctness checks must retain containment, opposing contacts,
compound fixtures, circles, and client/server agreement. The client contains
the corresponding algorithm, but these server profiles do not quantify its
client cost.

## Other server increases

Convoy, spread, and contact remained below **0.680 ms average CPU/tick** and
**1.154 ms elapsed p95** at 32 players here, while still costing 7–73% more CPU
across the matrix. Those increases should not be described as unchanged
performance merely because their absolute costs remain small on this host.

The commits increase entity load range from 2,000 to 2,500 and unload range from
2,500 to 3,000. A load-radius increase of 25% can cover 56% more area in a uniform
field. At the end of the 32-player spread fixture, active entities increased
from 748 to 1,128. New radar contact scans, replication fields, and gameplay
rules add work as well. Entity counts are end-of-capture counts, not average
counts over all ticks.

Longer before/current spread CPU profiles used 18,000 measured ticks each.
Current cost is distributed across simulation, entity updates, region syncing,
and replication: `UpdateWorld` is 52.6% cumulative and binary encoding 26.5%.
That pattern differs from the module case's recovery hotspot. Absolute sampled
CPU in entity updates rose from 1.06 to 2.03 seconds and binary encoding from
1.71 to 2.75 seconds. These profiles have different scene outcomes and cannot
assign a precise fraction of the increase to radar versus larger active regions.

Removing recovery in three additional current-revision captures per ordinary
32-player workload produced 0.506/0.539/0.313 ms CPU per tick for
convoy/spread/contact. Spread and contact did not return to the old revision's
cost; recovery alone does not explain their increases. These diagnostics also
change gameplay outcomes and were not interleaved with the original pair matrix.

## Existing client findings

Chrome 155 maintained approximately 119–120 FPS at both rendering sizes. Its
whole-scene FPS differences were within about 0.4%, against a roughly 120 Hz
ceiling. That ceiling limits sensitivity to smaller increases in work.
Firefox 158 showed a material slowdown in the saved captures:

| Scenario | Firefox 2560 × 1440 before/current FPS | Change | Firefox 3840 × 2160 before/current FPS | Change |
| -------- | -------------------------------------- | ------ | -------------------------------------- | ------ |
| Live     | 118.10 / 94.57                         | −19.9% | 88.77 / 90.10                          | +1.5%  |
| Large    | 113.80 / 85.20                         | −25.1% | 98.60 / 85.50                          | −13.3% |
| Combat   | 96.04 / 80.89                          | −15.8% | 103.87 / 86.72                         | −16.5% |
| Flight   | 107.11 / 86.65                         | −19.1% | 97.09 / 87.61                          | −9.8%  |

The simple reference canvas remained approximately 120 FPS. At 1440p,
Firefox mean measured frame work increased by about 1.4–1.7 ms across the game
scenarios. In the isolated large/combat/flight cases, the increases in recorded
mean update and prediction durations sum to about 0.24–0.34 ms. These per-call
means are not a complete decomposition of work per frame.
At 4K, isolated prediction cost was flat or lower while frame rates fell.
This points toward other rendering/UI work as a contributor, rather than
establishing a prediction-only explanation. Per-frame HUD DOM updates, minimap
drawing, and translucent panels with backdrop blur are concrete changed paths
to investigate. No saved Firefox profiler capture isolates them, so a specific
CSS or HUD operation is not proven responsible. The default rendering diagnostic
matrix uses Chrome and cannot resolve a Firefox-specific regression.

These were 30-second captures with production source transforms and CSS, active
HUD checks, and no recorded browser exceptions. All five scenarios per browser
and size and all 16 rendering diagnostics per revision completed. The physical
laptop display is 1920 × 1200 at approximately 119.9 Hz: the larger viewport and
canvas sizes were verified, but these are not native 1440p/4K scanout tests and
are not directly comparable with earlier desktop captures. Before/current
browser captures were sequential rather than interleaved repeated pairs, so
thermal and run-order effects remain possible.

The isolated fixture leaves the last live radar contact list in place, often
empty. It therefore underrepresents populated radar-map work. Its stationary
objects, live world evolution, and changed game specs are further limits on
claims of identical scene cost.

Existing input-response captures found local first motion at 6.6/7.3 ms with
0/5 ms one-way delay, versus 12.0/13.9 ms before. The delayed current capture
also shows a consistent approximately 33 ms remote/local phase offset versus
about zero before; this remains an observation requiring repeated timing
diagnostics, not an established code regression. Four-client captures found
zero measured receive/snapshot position jumps in both revisions. Brief network
outage captures found no missing ships or freezes in either revision. Additional
current-only client/server stall modes were captured; the paused client caused
47 observer freeze samples, without disappearing ships. There is no matched
before capture for those two modes.

## Resource sizes and runner repairs

| Resource                      | Before bytes | Current bytes | Change          |
| ----------------------------- | ------------ | ------------- | --------------- |
| All emitted JavaScript chunks | 250,866      | 269,510       | +18,644 (+7.4%) |
| All emitted CSS               | 13,719       | 17,465        | +3,746 (+27.3%) |
| Stripped production server    | 13,095,072   | 13,164,704    | +69,632 (+0.5%) |

These sizes describe the product changes in the three commits. The benchmark
repairs did not change emitted product asset sizes. Before/after production
builds and lint passed during runner repair. Successful captures exercised the
updated runners, including all live startup paths in the fresh full rerun.

The old runners expected immediate gameplay, old module paths, and the network
constructor in the entry chunk. They now enter through the current startup
flow, locate the lazy network chunk, accept `$` in minified identifiers, and
record startup attempts/failures. The fresh live suite needed at most two Play
attempts. Local runners reuse the standard Go/Vite proxy on 3001/3000; rendering
diagnostics require Vite benchmark mode. Gameplay fixtures load production CSS
and assert the current HUD is shown. The isolated world reports a connected
state so HUD work is included after its real socket callbacks are detached.

## Evidence and reproduction

The [retained evidence](../../../benchmarking/archive/README.md#2026-10-18)
contains immutable compressed captures, CPU/allocation profiles, compiler and
executable hashes, the attribution patch, and checksums. The live raw capture
remains ignored scratch output, as required by the live benchmark convention.
It is identified by hash in the retained reproduction metadata.

Compile each revision from its own directory:

```sh
CGO_ENABLED=0 GOEXPERIMENT=simd go test -c \
  -pgo=./src/server/default.pgo \
  -o /tmp/unicorn-regression-current.test ./src/server/network
```

Use a different output name for the before revision, then run the paired suite
sequentially without competing browsers, builds, or tests:

```sh
BEFORE_GOGC=200 AFTER_GOGC=200 GOMAXPROCS=2 GOMEMLIMIT=off \
  CPU_AFFINITY=0,1 OUTCOME_COMPARISON=report TICKS=1800 REPETITIONS=3 \
  RESULT=benchmarking/local/server-paired.json \
  node benchmarking/tools/go-cpu-paired.ts ui-collision \
  /tmp/unicorn-regression-before.test /tmp/unicorn-regression-current.test
```

For a CPU profile, run one executable with `SESSION_PLAYERS=32`,
`SESSION_WORKLOAD=module`, `SESSION_TICKS=1800`, `SESSION_RESULT=...`, and
`SESSION_CPU_PROFILE=...`, passing `-test.run '^TestSessionBenchmark$'` under
the same runtime settings and affinity. For allocations, omit
`SESSION_CPU_PROFILE` and add `-test.memprofile=...`, then inspect the profile
using `go tool pprof -sample_index=alloc_space`. The diagnostic overlay is
documented beside the retained patch and is not a production recommendation.
