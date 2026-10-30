# Collector NPC implementation and measurements, October 30, 2026

Collectors use the Finch's normal engines, two cargo hatches, six-object hold,
collision physics, and station trading. They clean up aged loose cargo around
stations without attacking players. Initial functional checks, local CPU and
rendering measurements, lint, formatting, and the complete final test rerun
passed. Final browser UI verification also passed.

## Behavior and persistence

Tuning lives in `src/specs/npcs/collector.ts`. Pirate tuning moved to the same
directory, and both specs provide randomly selected NPC names. Collector
dialogue lives in `src/specs/dialog/collector.ts`.

| Rule                  | Implemented behavior                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating area        | 10,000 meters around the originating station.                                                                                                                                                                                                               |
| Station observation   | Each station independently checks after a random 120–300 simulation seconds.                                                                                                                                                                                |
| Item age              | An eligible item must remain loose across consecutive checks. A pickup invalidates its earlier observation and existing trip occurrence, even if the same ID is dropped again.                                                                              |
| Dispatch              | At least three aged items; one fixed list of up to six items per Finch, with five seconds between departures. Stations do not coordinate.                                                                                                                   |
| Eligible cargo        | Existing collectible cargo, excluding destroyed/buried objects and message/unlock items. Ordinary accidental pickup mechanics are unchanged.                                                                                                                |
| Next pickup           | Nearest remaining listed item to the Finch.                                                                                                                                                                                                                 |
| Missing items         | Visit the recorded position before advancing the missing-item dialogue and list. Queued trips retain missing entries.                                                                                                                                       |
| Failed approaches     | Give up after five minutes for this trip, with the item name in dialogue. Other trips can try again. Missing and unlisted approaches are also bounded.                                                                                                      |
| Unexpected items      | Inspect a closer unlisted item within 80 meters once per trip, with hatches closed. Face it, speak after five seconds at the inspection position, and leave after another five seconds. Inspection time does not consume the current listed pickup attempt. |
| Return                | Full hold, loss of a hull segment or module, leaving the operating radius, or finishing the list. An attack alone does not trigger retreat.                                                                                                                 |
| Unloading             | Dock, use the existing `sell` action to transfer cargo into station inventory, then remove the NPC.                                                                                                                                                         |
| Stranding/destruction | Fuel exhaustion or loss of propulsion leaves the ordinary ship stranded. Destruction uses existing cargo and wreckage handling.                                                                                                                             |
| Appearance            | Existing Finch paint and loadout; no weapons or shields. A short TODO covers possible shields in dangerous sectors.                                                                                                                                         |

Collectors and pirates now save their physical ship, cargo, identity, and
controller state. Collector station observations, departure queues, pickup
attempts, and inspections also survive restart. Simulation ticks are restored,
so stopped-server time does not consume these timers. NPC observers keep nearby
physics running without human players; station physics is activated near NPCs
for departure and docking. Saving ships and controller state together preserves
cargo transfers through the existing persistence transaction. Recovery details
are documented in [PERSISTENCE.md](../PERSISTENCE.md).

## Shared movement and measured optimization

Collectors use the existing pirate pilot for travel, asteroid routes, avoidance,
and docking. Collection now evaluates every working cargo throat and can angle
either Finch hatch toward the item. Physical collection still determines
whether an item enters cargo.

The movement tests cover 63 Finch cases across cargo types, headings, moving
and spinning items, an asteroid field, and close asteroid approaches. Ordinary
nearby pickups took about 1.5–1.6 simulation seconds; the 1,050-meter asteroid
field took 5.87 seconds without hull damage. Difficult pickups beside a square
asteroid took 12.53–33.03 seconds without hull damage. Existing pirate movement
tests passed.

Two measured changes reduced CPU work without changing gameplay timing:

- Compare squared distances to the hatches and take one square root for the
  closest result, instead of calculating a hypotenuse for every hatch.
- Remember station discovery by item region. Repeated discovery no longer
  replaces the procedural region manager's active query or unloads its region
  descriptions. Discovery still checks for new item regions every second;
  station observation intervals remain unchanged.

Five repetitions per case used a one-second Go benchmark target, on an AMD
Ryzen 7 5800X3D with `GOMEMLIMIT=300MiB`, `GOEXPERIMENT=simd`, and 16
`GOMAXPROCS`. Recorded runtime verification reports
`go1.27.1-X:simd` and a 314,572,800-byte memory limit. Results below are medians
of elapsed time per operation; process CPU is measured separately below.

| Fixed microbenchmark           | Before ns/op | After ns/op | Interpretation                                                                          |
| ------------------------------ | -----------: | ----------: | --------------------------------------------------------------------------------------- |
| Finch nearby pickup decision   |      154,117 |     110,999 | 28.0% less time per decision.                                                           |
| Finch pickup behind the ship   |      143,476 |     102,115 | 28.8% less time per decision.                                                           |
| Finch travel decision          |        1,459 |       1,714 | Unchanged code path; the after run included a 3,498 ns outlier. No improvement claimed. |
| Discovery with 256 loose items |       53,959 |      21,494 | 60.2% less time per scan/view; 56,800 → 8,128 B/op and 208 → 8 allocations/op.          |
| Discovery without loose items  |       13,457 |      13,821 | Control case; no material improvement claimed.                                          |

Movement uses the same 5 Hz decision cadence and 40-step collection forecast
before and after. Discovery uses 2,000 unrelated entities, 256 loose items across
16 regions split between active and sleeping storage, and the ordinary region
view after each one-second discovery scan. Its remaining allocations include
that view. Pickup allocations remained 32/op, about 2,066 B/op.

These were the exact paired commands, run before and after each change:

```bash
GOMEMLIMIT=300MiB GOEXPERIMENT=simd GOCACHE=/tmp/collector-go-cache go test ./src/server/npc -run '^$' -bench BenchmarkFinchPickup -count=5 -benchtime=1s > /tmp/finch-movement-before-benchmark.log
GOMEMLIMIT=300MiB GOEXPERIMENT=simd GOCACHE=/tmp/collector-go-cache go test ./src/server/npc -run '^$' -bench BenchmarkFinchPickup -count=5 -benchtime=1s > /tmp/finch-movement-after-benchmark.log
GOMEMLIMIT=300MiB GOEXPERIMENT=simd GOCACHE=/tmp/collector-go-cache go test ./src/server/network -run '^$' -bench BenchmarkCollectorDiscovery -count=5 -benchtime=1s > /tmp/collector-discovery-before.log
GOMEMLIMIT=300MiB GOEXPERIMENT=simd GOCACHE=/tmp/collector-go-cache go test ./src/server/network -run '^$' -bench BenchmarkCollectorDiscovery -count=5 -benchtime=1s > /tmp/collector-discovery-after.log
```

Separate before-source snapshots were not retained. The movement baseline
already included both-hatch planning and used `min(Hypot(...))`; the candidate
uses `sqrt(min(x*x+y*y))`. The discovery baseline allocated a region map per
scan; the candidate retains that map on the sector runtime. Raw outputs and
runtime verification are archived in the ignored directory
`benchmarking/_local/collectors-2026-10-30/`.

Current NPC benchmark tools live in `benchmarking/npc`; see
[`benchmarking/README.md`](../../benchmarking/README.md#npc) for current commands.
The commands below are the historical commands used for these archived captures;
collector cases are no longer part of the rendering suite.

## Local whole-server CPU

`benchmarking/_local/collector-cpu-baseline.json` contains the complete 15-case
supplementary matrix: five scenarios, three repetitions, 15 seconds of warmup
and 30 seconds of measurement per case. The second repetition reverses scenario
order. This measures the implemented collectors against matched idle scenes;
it is not a before/after whole-server comparison of the micro-optimizations.

```bash
node benchmarking/server/collector-run.ts --cores 2 --repetitions 3 --output benchmarking/_local/collector-cpu-baseline.json
```

The extensive local session began with one `npm run reset-world:local` at
02:17:13 UTC, archiving the previous database as
`.data/world.sqlite.reset-4115546101`. No Go watcher was running before the reset;
the normal watcher was started afterward. Later browser-fixture cleanup removed
only fixture artifacts; the world was not reset again. Live world data was
untouched. The reset log is included in the raw archive.

The local watcher used the live memory budget of `GOMEMLIMIT=300MiB`, default
`GOGC=100`, and Go 1.27.1 with SIMD. Affinity was limited to logical CPUs 0–1;
the cores flag does not configure memory. The fixture primes initial item age
only and retains ordinary launch spacing, flight, pickup, and selling behavior.
These additional scenes leave the standard benchmark matrix unchanged.

| Scenario                      | Cargo objects | Maximum collectors | Median Go-process CPU, % of one core |
| ----------------------------- | ------------: | -----------------: | -----------------------------------: |
| Empty                         |             0 |                  0 |                                0.433 |
| Waiting for dispatch          |             6 |                  0 |                                0.433 |
| One collector                 |             6 |                  1 |                                0.499 |
| Crowded, waiting for dispatch |            48 |                  0 |                                0.566 |
| Crowded, collecting           |            48 |                  8 |                                0.766 |

The paired medians add about 0.066 percentage points of one core for one Finch
and 0.200 points for the eight-Finch scene. Process counters have a 20 ms
quantization bound over each 30-second window, about 0.067 percentage points;
the small single-Finch difference is near that resolution. Machine CPU includes
the OS, generator overlap, and background work, so the table uses the separately
recorded Go-process counters. Local hardware does not establish Fly CPU usage.

Each measurement received 900–902 snapshots, with no client errors or skipped
server ticks. Single-collector windows recorded 6, 5, and 2 pickups; crowded
windows recorded 1, 2, and 1, with four additional departures in each window.
The crowded result measures flight and inspection as well as collection; it
does not establish complete cleanup throughput or completion of every trip.

## Local client rendering

`benchmarking/_local/collector-rendering-baseline.json` passed validation for all
five scenes. Chrome 156.0.8078.73 ran production transforms and minification at
the native 3840 × 2160 viewport, device pixel ratio 1, with a calibrated
119.94 Hz refresh rate. Each scene has one 30-second capture, so comparisons are
descriptive rather than statistically established regressions.

```bash
GAMEPLAY_SCREENSHOTS=1 npm run benchmark -- --browser chrome --scenario collector-empty,collector-idle,collector,collector-crowded-idle,collector-crowded --output benchmarking/_local/collector-rendering-baseline.json
```

| Scene and screenshot                                                                                   |   FPS | Mean frame work, ms | p95 frame work, ms | Maximum visible collectors | Pickups during capture |
| ------------------------------------------------------------------------------------------------------ | ----: | ------------------: | -----------------: | -------------------------: | ---------------------: |
| [Empty](../../benchmarking/_local/collector-rendering-baseline-collector-empty.png)                    | 64.13 |               1.227 |                3.2 |                          0 |                      0 |
| [Six items, waiting](../../benchmarking/_local/collector-rendering-baseline-collector-idle.png)        | 79.81 |               1.179 |                2.9 |                          0 |                      0 |
| [One collector](../../benchmarking/_local/collector-rendering-baseline-collector.png)                  | 82.41 |               1.459 |                3.0 |                          1 |                      4 |
| [48 items, waiting](../../benchmarking/_local/collector-rendering-baseline-collector-crowded-idle.png) | 79.73 |               1.678 |                3.2 |                          0 |                      0 |
| [Crowded departure ramp](../../benchmarking/_local/collector-rendering-baseline-collector-crowded.png) | 82.01 |               2.728 |                5.5 |                          7 |                      0 |

Mean frame work increased by 0.280 ms for the single collector relative to the
six-item idle scene, and 1.050 ms for the crowded departure ramp relative to its
48-item idle scene. Frame-interval p95 was 16.7 ms in every scene. FPS varied with
browser cadence; the higher FPS in active scenes is not evidence that collectors
improve performance. Frame work includes client update, prediction, and drawing
work; it is not isolated GPU time or browser-process CPU.

The ordinary collector picked up four items. The crowded scene launched seven
visible Finches during the capture and recorded no pickups: several were
performing the required ten-second inspections of items outside their own
lists. That behavior has a real cleanup-throughput cost in dense overlapping
lists, even though it validates the flight/inspection rendering workload. These
captures do not demonstrate that a crowded fleet completes cleanup quickly.

An earlier run failed scene-isolation validation and is retained as
`benchmarking/_local/collector-rendering-isolation-failed.json`; it is excluded
from this comparison. The completed runner waits for actual socket disconnect
and authoritative fixture cleanup between cases.

## Build sizes and final verification

The initial, implementation, and final-test builds passed. Their rounded emitted sizes were
unchanged: gameplay JavaScript 122.11 kB and ship JavaScript 97.14 kB. The build
plugin reported gameplay gzip unchanged at 51,526 bytes and ship gzip
41,378 → 41,379 bytes. Existing 14 kB chunk warnings remain. Concurrent user
ship/module edits are present, so these whole-workspace changes cannot be
attributed solely to collectors. Logs are archived with the microbenchmarks.

The complete `npm run test` passed, including the production build, all Go
packages, and 125 Node test files, with no failures or skips. `npm run lint` and
the custom Go formatting check also passed. Their logs are archived alongside
the measurements as `collector-all-tests.log`, `collector-final-lint.log`, and
`collector-go-format.log`. Browser UI verification passed deferred startup,
navigation, preferences, identity, preview, desktop layout, trading, repairs,
paint, focus, and launch:

```bash
CHROME_BIN=/usr/bin/google-chrome GOCACHE=/tmp/collector-go-cache npm run test:ui
```

The UI log is archived as `collector-final-ui.log`. No source changes followed
the final build, tests, and lint. No deployment or live benchmark is part of
these results.
