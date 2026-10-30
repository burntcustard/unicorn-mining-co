# Benchmarks

Run one suite at a time. The NPC collection command builds and starts its own
services; other suites require `npm run build` first. Local benchmarks use the
normal frontend and Go server on ports 3000/3001. Captures are saved in
`benchmarking/_local/`, including partial results when a run fails.

| Suite                | Command                                       |
| -------------------- | --------------------------------------------- |
| Rendering            | `npm run benchmark -- --browser chrome`       |
| NPC collection       | `npm run benchmark:npc:collection -- --watch` |
| NPC                  | `npm run benchmark:npc -- --scenario all`     |
| Server CPU, local    | `npm run benchmark:server:local -- --cores 2` |
| Server CPU, live     | `npm run benchmark:server:live`               |
| Input latency, local | `npm run benchmark:latency:local`             |
| Input latency, live  | `npm run benchmark:latency:live`              |

All suites accept `--output PATH`. Finish builds, tests and profiles before
measuring performance.

## Rendering

One visible browser runs at the monitor's native resolution and pixel density.
Choose `--browser chrome` (default) or `--browser firefox`. A short idle calibration
measures refresh cadence automatically; frame statistics use that measured period.

| Scenario | Workload                                                         |
| -------- | ---------------------------------------------------------------- |
| `live`   | Networked flight with the search light active                    |
| `large`  | Large asteroids, weapons and fractures                           |
| `combat` | Turning and firing among asteroids                               |
| `flight` | Flight and firing through an asteroid corridor                   |
| `pirate` | Three different ships fighting around asteroids using real Go AI |

The default runs all five. Select one with `--scenario pirate`, or pass a
comma-separated list. The suite shares one browser and reuses its page for
isolated worlds; networked cases start a fresh page. Normal graphics, HUD,
audio and the FPS display stay active. Measurement defaults to 30 seconds;
`--seconds N` changes it.
Armed fixtures use one ordinary 200-round ammo item per ship that needs it.

The pirate case uses a local compiler fixture. Prepare it, then start the Go
watcher with the printed overlay setting on its normal port:

```sh
npm run benchmark:pirate:prepare -- /tmp/unicorn-pirate-rendering
GOFLAGS=-overlay=/tmp/unicorn-pirate-rendering/overlay.json npm run dev:server
```

Replace the existing Go watcher for this configuration, keep Vite running, and
restore ordinary `npm run dev:server` afterward.

## NPC

Run the complete collection comparison with one command:

```sh
npm run benchmark:npc:collection -- --watch
```

It builds the project, prepares a fresh private world and fixture, starts the Go
server and frontend, then runs `collection-courser` and `collection-finch`.
Chrome follows the active NPC with the normal camera and HUD. Without `--watch`,
the same command runs without a browser. By default, six windows run continuously:
three Courser cases across the top row and three Finch cases below them, tiled for a 3840×2160 screen. Each hull
has a shared queue; its next available window immediately starts the next seed
without waiting for other windows. Each hull gets nine runs, with
paired seeds 1–9. Each run has up to 120 seconds and no warmup, ending immediately
on docking. The complete comparison takes at most about six minutes plus setup.
Each case has a separate copy of the same procedural sector, so other cases
cannot take its cargo or collide with its ship. The first six cases launch together once their clients and browser
views are ready. Subsequent runs start independently as soon as a window is free.
Options such as `--seconds 30`, `--repetitions 3` and `--output PATH`
work as in the ordinary NPC suite. Use `--concurrency 1` for serial comparisons.
Add `--scenario all --concurrency 1` to run all seven NPC cases with the same
automatic setup; CPU-only scenes remain serial.

Collection items use seeded random x/y positions around the station, avoiding
existing hulls, asteroids, and overlapping pickups. Each repetition uses a new
seed; both hulls receive matching layouts, with the Finch using six of the
Courser's eight positions to match their cargo capacities. Items remain within
roughly 1,400 units of the station. The five ordinary collector CPU scenes keep
their existing layouts and timing.

The report records each seed and the station-relative positions, and the runner
verifies that paired layouts match. Its summary
includes completion rate, average fraction collected, and mean/median completion
time with the number of completed runs. Unfinished runs stay in the success and
pickup averages; completion times include completed runs only. Pickups after the
measurement cutoff do not count toward collection scores.

`--seed 1` is the default starting seed; repetitions increment it, wrapping after
4,294,967,295. Replay a particular layout or run a short visual check with:

```sh
npm run benchmark:npc:collection -- --watch --repetitions 1 --seed 7
```

The command reuses this checkout's running Vite service. It temporarily stops a
verified game watcher from this checkout if needed, then restores it when the
benchmark finishes or is interrupted. The managed fixture builds once and keeps
its Go simulation fixed during capture; editing source does not restart it.
Both stdout and stderr are retained in the session's `capture.log`, including
errors, while also appearing in the terminal. Unrelated services are reported as port
conflicts. The private world is reset once for the complete comparison; the
normal local world is preserved. No separate terminal setup is needed.

The ordinary NPC runner and advanced tools can also use the manual setup below.

NPC benchmarks live in `benchmarking/npc`, separate from rendering and the
standard server CPU matrix. Run all seven cases with
`npm run benchmark:npc -- --scenario all`. The default opens no browser.
Add `--watch --browser chrome` to watch the running NPCs in a game client.
Watch mode mirrors the benchmark's existing binary snapshot stream. Its view
anchor has no hull, modules, collision body, or simulation player registration;
only NPCs fly in the scene. Docking closes the collection view immediately, with
no fallback to a player ship. The existing pirate combat
rendering case remains part of the rendering suite above.

The collector workload has five matched cases: `collector-empty` observes an
empty station area, `collector-idle` observes six loose items awaiting their
next station check, and `collector` lets a real Finch launch and collect those
same items. `collector-crowded-idle` and `collector-crowded` use 48 items to
measure shared airspace and inspection behavior under greater load.
`collection-courser` and `collection-finch` exercise the shared pickup behavior
with each stock hull: eight items for the Courser and six for the Finch. These
launch after warmup so collection starts inside the measurement window. Select one case or a comma-separated list with `--scenario`.

The preparation command runs `benchmarking/npc/fixture.ts`; the suite entry is
`benchmarking/npc/run.ts`.

```sh
npm run benchmark:npc:prepare -- /tmp/unicorn-npc-benchmark
GOMEMLIMIT=300MiB GOFLAGS=-overlay=/tmp/unicorn-npc-benchmark/overlay.json npm run dev:server
npm run benchmark:npc -- --scenario all --output benchmarking/_local/npc.json
npm run benchmark:npc -- --scenario all --watch --browser chrome --output benchmarking/_local/npc-watch.json
```

Prepare the overlay after the final production build and use the normal server
port. Replace only the existing Go watcher when applying the overlay, and
restore the normal budget-matched watcher afterward. This fixture is local only.
Stop the existing watcher itself before starting its replacement, including a
watcher running in another terminal or in the background. A second server cannot
open the same world database. Wait for the fixture server's listening message on
port 3001 before running the suite, and keep Vite running on port 3000.
The runner checks the server's memory settings, overlay, and frontend before
opening Chrome. Failures print the cause and report path in the terminal.
Reset the local world once before the complete comparison session as required
below, not between individual cases.

The NPC cases supplement the unchanged normal CPU workload matrix. All seven
default to 15 seconds of warmup, a 30-second measurement limit and three
repetitions, alternating case order. The five CPU scenes keep fixed measurement
windows; collection scenes stop on docking and record their actual elapsed time
and end reason. The runner checks `GOMEMLIMIT=300MiB` and
`GOGC=100`, records the same process/machine CPU counters as the standard suite,
and restores CPU affinity after completion or interruption. Server CPU and
generator counters are recorded once for the continuous suite under
`measurement`, including preparation between runs and finalization. Individual
results identify their window under `lane`. Counters describe combined load,
not per-NPC costs; use the same concurrency and watch settings when comparing
CPU results. Serial runs additionally retain per-case `serverCpu` counters for
comparing the five CPU scenes. Client health,
snapshot traffic, observed collector motion/cargo and authoritative pickup
events accompany the timings. Reports identify watch mode; keep watched and
unwatched results separate when comparing host load.

The ordinary collector compiler fixture creates six gold items at fixed clear
positions near one existing station. It primes the active station's initial item
observation once, avoiding a two-to-five-minute setup wait; the idle case's next
check is 180 seconds away. Production launch spacing, physics, flight, pickup,
cargo capacity and sale remain unchanged. Captures are limited to 120 seconds.
The fixture records launches and pickups and counts deposited items after
disconnect, then removes only its own NPCs and items and restores the previous
station clock. It never clears ordinary world geometry.

An optional second fixture argument chooses 3–48 items for the ordinary case;
the crowded cases always use 48. Keep that count fixed across comparisons.
Dense multi-collector scenes can spend part of a capture inspecting items
assigned to another collector. The ordinary active case requires real pickups;
the crowded case requires active collectors and retains its actual pickup count,
including zero, to expose that behavior. Compare CPU alongside the recorded work rather than treating a lower activity rate as a CPU saving.

For optional Go-only collection diagnostics, run the microbenchmarks from the
same folder. These accelerated cases have no browser watch scene. `Collection`
includes fixture construction and complete physical pickups; `CollectionSteering`
measures repeated steering decisions without advancing physics. Both cover the
Courser and Finch. `CollectorDispatch` includes normal dispatch bookkeeping and
station discovery, so its timings are not comparable to the former private
discovery-only benchmark.

```sh
GOMEMLIMIT=300MiB GOMAXPROCS=2 GOEXPERIMENT=simd go test ./benchmarking/npc -run '^$' -bench '^Benchmark(Collection|CollectorDispatch)' -benchmem
```

### Cleanup after real mining

For collector cleanup measurements, use actual debris from the existing
32-player `module` workload. The passive overlay samples eligible loose items,
station clocks/queues, NPC targets/positions/cargo, and inventories every five
simulation seconds. It buffers exact pickup/launch-observation ticks and samples
human connection transitions immediately. It does not create items, prime age
observations, alter player controls, or remove debris.

```sh
node benchmarking/npc/collector-cleanup-overlay.ts /tmp/unicorn-collector-cleanup
GOMEMLIMIT=300MiB GOFLAGS=-overlay=/tmp/unicorn-collector-cleanup/overlay.json COLLECTOR_CLEANUP_TELEMETRY="$PWD/benchmarking/_local/collector-cleanup/mining-telemetry.jsonl" npm run dev:server
node benchmarking/npc/collector-mining-run.ts --mining-seconds 150
node benchmarking/npc/collector-cleanup-analysis.ts benchmarking/_local/collector-cleanup/mining-telemetry.jsonl benchmarking/_local/collector-cleanup/mining-analysis.json
```

Create the telemetry directory before starting the watcher. Reset the local
world once before the full session, with the watcher stopped. The mining wrapper
keeps the standard 180-second case, 15-second warmup, 32 miners, two-core affinity,
and readiness checks. It sends SIGINT at the requested time after the actual
measurement-start marker, closes all miners normally, and preserves their loose
items. Preparation defaults to 600 seconds and can be extended with
`--prepare-timeout`; do not reduce the player count after a failed preparation.
Choose and record the generation duration before freezing the comparison input.

After disconnect and the normal three-second ship-hide cooldown, gracefully
stop the watcher and copy the closed SQLite database, including a checksum.
Restore a copy of that same checkpoint for both the baseline and every candidate;
do not reset the world again between comparisons. Freeze a minimal cohort JSON
array of `{ "sectorID": "...", "id": 123 }` entries. Report all eligible loose
items, and retain a separate manifest for IDs outside every station's operating
range. Use the fixed initial in-range cohort for the primary cleanup comparison.

An optional `--deterministic-checks` argument generates a comparison overlay that
replaces only the station interval random fraction with SplitMix64 of simulation
tick XOR world seed. Configured interval bounds and all gameplay delays remain
unchanged. Use the same mode for both baseline and candidates, and regenerate
the overlay after each production change so it does not retain old source.
The generated `manifest.json` records the mode. Ordinary production RNG is used
when the flag is absent.
To measure a previously frozen variant, pass `--base-overlay /path/to/overlay.json`.
The generator inherits those source replacements and adds the current passive
instrumentation; the variant's source files must remain available and unchanged.
Its `source-hashes.json` records every replacement for verification.

```sh
node benchmarking/npc/collector-cleanup-overlay.ts /tmp/unicorn-collector-cleanup-replay --deterministic-checks
node benchmarking/npc/collector-cleanup-run.ts --telemetry benchmarking/_local/collector-cleanup/baseline-telemetry.jsonl --cohort benchmarking/_local/collector-cleanup/cohort-in-range.json --origin benchmarking/_local/collector-cleanup/disconnect.json --cpu-seconds 300 --cpu-start-tick 29201 --output benchmarking/_local/collector-cleanup/baseline-real.json
```

The cleanup runner is a passive observer of an already running normal watcher.
It records the live memory budget, affinity, Linux CPU counters, and complete
residual cohort. CPU compares server-owned `RUSAGE_SELF` counters at exact
simulation tick boundaries (29201→38201 for the example), with measured wall time
for the percentage of one core. The helper captures the restored initial tick
before simulation advances; start both watchers with the same two-CPU affinity
already applied so the complete window uses that limit. Both versions need the
same passive overlay instrumentation and checkpoint.

The runner stops after the fixed CPU window by default. Add `--continue-cleanup`
to keep observing until all cohort items have confirmed collector pickups or
the default 1,800-wall-second limit expires, while retaining the same initial
CPU window for comparison. Completion also requires a snapshot
confirming every cohort item remains in collector cargo or station inventory;
a later cargo drop cannot falsely complete the capture. Use `--continue-deposit`
instead to continue until every cohort ID is in station inventory. Both modes
retain the fixed initial CPU window. The runner restores affinity when finished.
Exact pickup-based T50/T90/T100 are separate from five-second snapshots showing
items no longer loose; missing items and pirate pickups cannot falsely satisfy
collector completion. Simulation elapsed time uses the original disconnect tick.
Wall time from the original disconnect includes any checkpoint downtime, while
the recorded CPU window covers only the specified running simulation ticks.

Closed-database replay normalizes saved positions, discards transient objects,
and reconstructs pilot caches. Both compared versions must start from the same
restored input. Accelerated replay tests can locate behavior and CPU hotspots;
they are not wall-clock server CPU percentages. Keep unrelated tests, builds,
and profiling off the host during final CPU captures, and preserve failed or
incomplete reports rather than interpreting less completed work as a saving.

The replay lives in `benchmarking/npc/replay` and observes the ordinary
session through its sector and player APIs. It clones the supplied closed
checkpoint before loading it; it never opens that source world for writing.
After generating the deterministic overlay above, run:

```sh
GOMEMLIMIT=300MiB GOEXPERIMENT=simd GOMAXPROCS=2 \
UNICORN_COLLECTOR_REPLAY_DB="$PWD/benchmarking/_local/collector-cleanup/checkpoint/world.sqlite" \
UNICORN_COLLECTOR_REPLAY_COHORT="$PWD/benchmarking/_local/collector-cleanup/cohort-in-range.json" \
UNICORN_COLLECTOR_REPLAY_OUTPUT="$PWD/benchmarking/_local/collector-cleanup/replay.json" \
go test -overlay=/tmp/unicorn-collector-cleanup-replay/overlay.json ./benchmarking/npc/replay -run '^TestCollectorCleanupReplay$' -count=1
```

Omit `-overlay` for ordinary production timer randomness. The default replay
duration is 1,800 simulation seconds; `UNICORN_COLLECTOR_REPLAY_SECONDS` changes
that diagnostic horizon without changing gameplay timing. The JSON summary and
adjacent `.jsonl` timeline retain exact pickups, launches, and per-second state.

The report retains confirmed pickup counts, per-item pickup times, T50/T90 and
completion time. Incomplete cases keep a null completion time; increase
`--seconds` to observe a full trip. `all` selects the seven real-time scenes;
accelerated Go microbenchmarks and checkpoint diagnostics are separate tools.

## Server CPU

The existing `server-load` log also reports `save_batches`, `save_players`,
`save_entities`, `save_capture_ms`, and `save_capture_max_ms` for its interval.
Capture time covers copying/submitting accepted batches on the simulation
owner; it excludes the writer's asynchronous encoding/SQL work and the
incremental checkpoint copies already included in tick timings. Check both
save-capture and tick maxima when evaluating longer save intervals. A
ten-minute log interval can span preparation and several measured workloads;
it cannot locate a spike in a particular client gap by itself.

The full matrix runs `convoy`, `spread`, `contact`, `module` and `weapon` for
4, then 8, then 16, then 32 lightweight binary-protocol clients.
Convoy follows a common heading, spread cruises through reserved clear corridors,
and contact keeps pairs colliding. Spread reserves corridors outside station
movement areas and checks sustained movement from every ship.

```sh
npm run benchmark:server:local -- --cores 2 --players 16 --workload spread
npm run benchmark:server:live -- --players 8 --workload weapon
```

Start extensive local testing with `npm run reset-world:local` while the Go
watcher is stopped, then restart it before the matrix. Live benchmarks use the
existing world.

For comparisons with the current live Go memory budget, start the normal local
watcher as `GOMEMLIMIT=300MiB npm run dev:server`. Keep the default `GOGC=100`.
The benchmark's `--cores 2` controls CPU affinity only; it does not set memory.
Verify `serverCores.runtimeEnvironment` in the capture before qualifying a
budget-matched result.

`--cores N` limits the local Go process to any supported positive number of
logical CPUs and restores its original affinity afterward. Load clients retain
access to the host's CPUs. `--players` and `--workload` select individual cases.
Defaults are 15 seconds of warmup and 30 seconds of measurement, controlled by
`--warmup` and `--seconds`. Setup defaults to ten minutes; use
`--prepare-timeout N` to allow longer searches. Ships wait with neutral
controls when ready, then start the measured workload together.

Spread cruises through 1800-unit corridors checked from real snapshots. Captures
allow up to 35 seconds; use `--repetitions N` for longer sampling.

Module ships prefer larger intact asteroids in separate working areas, with
hatches and search lights active. Drilling starts after warmup. Weapon loadouts repeat evenly:
unarmed, plasma accelerator, autogun and beam laser.
Ships buy and equip normally, fly outward for at least ten seconds, settle in
clear space, then fire. Each autogun buys one 200-round item. Weapon warmup is
nonfiring; measurements can run up to 35 seconds on that supply.

Results retain CPU counters and their scope, generator CPU/memory/event-loop
headroom, socket and receipt completion, input acknowledgments and actual work.
Snapshot rate, gaps and skipped ticks describe server cadence separately from
client health. Local results include isolated Go-process CPU and busy CPU on the
selected logical CPUs; Fly machine CPU includes its OS. Compare matching scopes,
core counts and runtime settings, alongside delivered snapshot rates. Match the
deployed `GOGC` and `GOMEMLIMIT` values locally. An unset `GOGC` uses Go's default
100; Fly specifies a `300MiB` Go memory budget for its 512 MiB machine. Check
Fly's CPU balance and quota throttling when interpreting live results: settings
restarts can discard accrued burst credit. Local core affinity does not emulate
Fly's shared CPU quota.

## Input latency

Four real Chrome windows share the server: one actor and three observers.
`--scenario steer|fire|both` selects actions; `--trials N` defaults to five per
action, with alternating left/right steering. Reports give the mean, range,
and observed/missed counts. This is a quick average; use more trials to compare
small differences. Temporary browser contexts receive local-network permission
automatically.

The actor uses trusted keyboard input. Reports measure input send, decoded
server acknowledgment and completed local/remote game draws, with per-observer
statistics and paired averages across all three observers. Clock uncertainty,
missed observations and browser health remain in the results. These are game
draw timings. Local and live runs use this checkout's built production client.

## Code

`rendering/`, `npc/`, `server/` and `latency/` own their suites; `utilities/` contains
shared helpers. Benchmark regressions live in `tests/benchmarking/`.

## Local archives

Keep raw captures, profiles, logs, screenshots, and archive files in the ignored
`benchmarking/_local/` directory. Keep reusable tools and Markdown reports in Git.
