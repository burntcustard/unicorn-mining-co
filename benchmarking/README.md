# Benchmarks

Run one suite at a time. The NPC collection command builds and starts its own
services; other suites require `npm run build` first. Local benchmarks use the
normal frontend and Rust server on ports 3000/3001. Captures are saved in
`benchmarking/_local/`, including partial results when a run fails.

| Suite                | Command                                       |
| -------------------- | --------------------------------------------- |
| Rendering            | `npm run benchmark -- --browser chrome`       |
| Mustang movement     | `npm run benchmark:movement`                  |
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

| Scenario | Workload                                                          |
| -------- | ----------------------------------------------------------------- |
| `live`   | Networked flight with the search light active                     |
| `large`  | Large asteroids, weapons and fractures                            |
| `combat` | Turning and firing among asteroids                                |
| `flight` | Flight and firing through an asteroid corridor                    |
| `pirate` | Three different ships fighting around asteroids using server NPCs |

The default runs all five. Select one with `--scenario pirate`, or pass a
comma-separated list. The suite shares one browser and reuses its page for
isolated worlds; networked cases start a fresh page. Normal graphics, HUD,
audio and the FPS display stay active. Measurement defaults to 30 seconds;
`--seconds N` changes it.
Armed fixtures use one ordinary 200-round ammo item per ship that needs it.

For a diagnostic comparison on a simulated slower main thread, Chrome accepts
`--cpu-throttle N` (for example, `--cpu-throttle 4`). The rate is recorded in
the report; the default is 1, with no throttling. This uses Chrome's CPU
throttling while retaining the real display cadence and unchanged scenarios.
Compare runs with the same rate and report them separately from normal results.

The pirate case uses a local Rust fixture. Prepare it, then start the
watcher with the printed overlay setting on its normal port:

```sh
npm run benchmark:pirate:prepare -- /tmp/unicorn-pirate-rendering
SERVER_BENCHMARK_FIXTURES=1 PIRATE_BENCHMARK_FIXTURE="$PWD/benchmarking/_local/rendering-pirate-fixture.json" npm run dev:server
```

Replace the existing server watcher for this configuration, keep Vite running, and
restore ordinary `npm run dev:server` afterward.

## Mustang movement

The benchmark opens a visible Chromium window and flies the stock Mustang and
every compatible thruster on its stock loadout. The browser holds forward
thrust for four seconds, coasts for thirteen, holds right turn for one and a
half, and releases it for one. Each case starts at rest on a clear lane with
a full tank and empty cargo.

Build first, then prepare a fresh private world with the local server watcher
stopped. Start the watcher with the benchmark feature, which provisions
loadouts at Play. Use the regular Vite frontend on port 3000.

```sh
npm run build
export DATABASE_PATH="$(mktemp -d /tmp/unicorn-mustang.XXXXXX)/world.sqlite"
npm run reset-world:local
SERVER_BENCHMARK_FIXTURES=1 MOVEMENT_BENCHMARK=1 npm run dev:server
```

With the watcher and `npm run dev -- --strictPort` running, start the benchmark
from another terminal. Set `CHROME_BIN` if your Chromium executable has a
different name from `google-chrome`.

```sh
npm run benchmark:movement -- --output benchmarking/_local/movement/current.json
```

The JSON includes the revision, world seed, and speed and spin from
authoritative server snapshots. Each phase starts with the last snapshot
before the corresponding control change. Forward acceleration is averaged
over 10–30% of peak speed, and coast deceleration over 90–70% of release
speed. Turning acceleration and deceleration use the first three full
ticks after the turn or release. The report also includes peak speed,
peak turn rate, and the time to coast to half speed. Linear units are
meters and seconds, and angular units are radians and seconds.

For a comparison, repeat with the other revision's frontend and server and
its own fresh world. Run the same movement workload from the checkout under test. After the suite,
stop the fixture watcher.
Restart the normal watcher without the benchmark environment to return
to your usual world.

## NPC

Run the complete collection comparison with one command:

```sh
npm run benchmark:npc:collection -- --watch
```

It builds the project, prepares a fresh private world and fixture, starts the Rust
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
existing hulls, asteroids, and overlapping pickups. A separate seeded stream
chooses gold, amethyst, diamond, or opal from the asteroid mineral specs without
changing the position draws. Each repetition uses a new
seed; both hulls receive matching layouts, with the Finch using six of the
Courser's eight positions to match their cargo capacities. Items remain within
roughly 1,400 units of the station. The five ordinary collector CPU scenes keep
their existing layouts and timing.

The report records each seed, mineral sequence, and station-relative positions, and the runner
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
its simulation fixed during capture; editing source does not restart it.
Both stdout and stderr are retained in the session's `capture.log`, including
errors, while also appearing in the terminal. Unrelated services are reported as port
conflicts. The private world is reset once for the complete comparison; the
normal local world is preserved. No separate terminal setup is needed.

The ordinary NPC runner and advanced tools can also use the manual setup below.

NPC benchmarks live in `benchmarking/npc`, separate from rendering and the
standard server CPU matrix. Run all seven cases with
`npm run benchmark:npc -- --scenario all`. The default opens no browser.
Add `--watch --browser chrome` to watch the running NPCs in a game client.
Watch mode mirrors the benchmark's existing binary snapshot stream. A docked
observer with an empty loadout anchors the view and stays outside collision
simulation. The browser hides the observer so only NPCs fly in the scene. The
collection view closes as soon as the NPC docks. The pirate combat case belongs
to the rendering suite above.

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
SERVER_BENCHMARK_FIXTURES=1 NPC_BENCHMARK_FIXTURE="$PWD/benchmarking/_local/npc-fixture.json" npm run dev:server
npm run benchmark:npc -- --scenario all --output benchmarking/_local/npc.json
npm run benchmark:npc -- --scenario all --watch --browser chrome --output benchmarking/_local/npc-watch.json
```

Start the fixture watcher on port 3001 with Vite on port 3000. The runner checks
the fixture manifest and frontend before opening Chrome. The fixture watcher
uses isolated in-memory sectors, which it discards after each run. Restart the
normal watcher to resume the usual local world.

The NPC cases supplement the unchanged normal CPU workload matrix. All seven
default to 15 seconds of warmup, a 30-second measurement limit and three
repetitions, alternating case order. The five CPU scenes keep fixed measurement
windows; collection scenes stop on docking and record their actual elapsed time
and end reason. The runner records the same process and machine CPU counters as the standard suite,
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

The ordinary collector fixture creates six gold items at fixed clear
positions near one existing station. It primes the active station's initial item
observation once, avoiding a two-to-five-minute setup wait; the idle case's next
check is 180 seconds away. Production launch spacing, physics, flight, pickup,
cargo capacity and sale remain unchanged. Captures are limited to 120 seconds.
The fixture records launches and pickups and counts deposited items after
disconnect, then discards the isolated sector.

An optional second fixture argument chooses 3–48 items for the ordinary case;
the crowded cases always use 48. Keep that count fixed across comparisons.
Dense multi-collector scenes can spend part of a capture inspecting items
assigned to another collector. The ordinary active case requires real pickups;
the crowded case requires active collectors and retains its actual pickup count,
including zero, to expose that behavior. Compare CPU alongside the recorded work rather than treating a lower activity rate as a CPU saving.

### Cleanup after real mining

For collector cleanup measurements, use actual debris from the existing
32-player `module` workload. Passive telemetry samples eligible loose items,
station clocks/queues, NPC targets/positions/cargo, and inventories every five
simulation seconds. It buffers exact pickup/launch-observation ticks and samples
human connection transitions immediately. It does not create items, prime age
observations, alter player controls, or remove debris.

```sh
mkdir -p benchmarking/_local/collector-cleanup
SERVER_BENCHMARK_FIXTURES=1 COLLECTOR_CLEANUP_TELEMETRY="$PWD/benchmarking/_local/collector-cleanup/mining-telemetry.jsonl" npm run dev:server
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

Start each comparison with the same saved checkpoint and telemetry configuration.

```sh
node benchmarking/npc/collector-cleanup-run.ts --telemetry benchmarking/_local/collector-cleanup/baseline-telemetry.jsonl --cohort benchmarking/_local/collector-cleanup/cohort-in-range.json --origin benchmarking/_local/collector-cleanup/disconnect.json --cpu-seconds 300 --cpu-start-tick 29201 --output benchmarking/_local/collector-cleanup/baseline-real.json
```

The cleanup runner is a passive observer of an already running normal watcher.
It records the live memory budget, affinity, Linux CPU counters, and complete
residual cohort. CPU compares server-owned `RUSAGE_SELF` counters at exact
simulation tick boundaries (29201→38201 for the example), with measured wall time
for the percentage of one core. The helper captures the restored initial tick
before simulation advances; start both watchers with the same two-CPU affinity
already applied so the complete window uses that limit. Both versions need the
same passive instrumentation and checkpoint.

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

The report retains confirmed pickup counts, per-item pickup times, T50/T90 and
completion time. Incomplete cases keep a null completion time; increase
`--seconds` to observe a full trip. `all` selects the seven real-time scenes.

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

Start extensive local testing with `npm run reset-world:local` while the server
watcher is stopped, then restart it before the matrix. Live benchmarks use the
existing world.

Match the deployed machine's memory budget in local CPU comparisons. The
benchmark records the server runtime environment and cgroup limits. `--cores 2`
controls affinity only.

`--cores N` limits the local server process to any supported positive number of
logical CPUs and restores its original affinity afterward. Load clients retain
access to the host's CPUs. `--players` and `--workload` select individual cases.
Local runs record server RSS and the operating-system memory limit.
Start the game server on port 3001 and reuse the standard Vite proxy.
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
client health. Local captures keep the original cadence and record each client's
snapshot gaps and longest silence after five seconds of server process uptime.
The cutoff applies to the server's startup across all clients. Local results
include isolated server-process CPU and busy CPU on the
selected logical CPUs; Fly machine CPU includes its OS. Compare matching scopes,
core counts and runtime settings, alongside delivered snapshot rates. Match the
deployed machine memory and runtime settings locally. Check Fly's CPU balance and quota throttling when interpreting live results: settings
restarts can discard accrued burst credit. Local core affinity does not emulate
Fly's shared CPU quota.

### CPU profiling

Use the private maintenance socket to collect a compressed profile from the
running local server. Use the same `DATABASE_PATH` as the server if it was
overridden. Collect diagnostic profiles separately from timed workloads.

```sh
node benchmarking/server/profile.ts --seconds 15 --output benchmarking/_local/server.cpu.pprof.gz
```

### Local memory timeline

Add `--memory-output FILE.jsonl` to a local server benchmark to sample the
server process and its Linux cgroup once per second. The CPU report records
the timeline path. Samples label workload preparation, measurement, and
benchmark cleanup. The process and cgroup peak counters retain their lifetime
high-water values, which can include startup before the benchmark connected.
For samples from before the server starts, run the reader separately with the
planned server cgroup path. Stop the standalone reader with Ctrl+C.

```sh
npm run benchmark:server:local -- --cores 4 --players 32 --memory-output benchmarking/_local/rust-memory.jsonl
node benchmarking/server/memory.ts --cgroup /path/to/server.scope --output benchmarking/_local/startup-memory.jsonl
```

Compare builds in dedicated server-only cgroups with the same four logical
CPUs, 1 GiB hard memory limit, swap policy, and disk-backed benchmark worlds.
The cgroup timeline includes total charged memory, anonymous memory,
file cache, shared memory, kernel memory, memory pressure, swap and OOM
counters. A file-cache charge can be reclaimed depending on its state.
Use total charged memory and the kernel peak for observed budget headroom.
The timeline also includes the cgroup CPU quota and throttle counters when
available. `null` indicates an unavailable kernel counter.

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
