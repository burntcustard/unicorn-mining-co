# Server CPU Investigation (October 27, 2026)

## Executive Summary

Latest deployed: [release 113 SQLite CPU follow-up](server-sqlite-cpu-investigation-2026-10-28.md)
completed all **20/20** unchanged default live workloads without throttling.
The run started 10.43 minutes after the post-reset ready marker. Balance never
fell below **183.82 CPU-seconds**, ending at **424.48**; enclosing whole-machine
CPU averaged **2.89%**. The live world was reset with explicit authorization.
Strict cadence passed **15/20**: delivery outliers remain. Distributed 32-player
mining passed cadence with maximum snapshot gap **48.18 ms** and input ACK
**53.71 ms**. Covering server intervals report zero tick overruns/catch-ups and
a **21.81 ms** maximum tick, below the 33.33 ms step. Controlled fixtures establish save-path CPU reductions; the
matched 16-player whole-game CPU screen is effectively unchanged, and differing
live world histories prevent attributing the lower live scores solely to code.

[Release 112 deferred saves and temporary-object filtering](server-deferred-persistence-investigation-2026-10-27.md)
passed all twenty unchanged local cases and all local cadence checks. Its
unchanged default live attempt stayed unthrottled after the ten-minute cooldown,
but only eighteen cases measured: both final 32-player setups failed. Live
delivery outliers remain. That release-112 attempt did not achieve an all-valid
qualification; release 113's completed run above supersedes it.

The [release 111 persistence and graphics-setting follow-up](server-persistence-investigation-2026-10-27.md)
records one-second background batching and the default-on saved blur option.
Both unchanged live attempts stayed unthrottled but each had nineteen valid
cases. Release 109's completed qualification below is historical and must not
be attributed to later releases.

**Historical release 109 result: quota goal met.** Release 109 completed the unchanged default live CPU suite: all five workloads at 4, 8, 16, and 32 players. All 20 cases passed workload, client-consumption, and generator-headroom validation. The quota-throttle counter stayed at zero through preparation, warmup, measurement, and cleanup. Sampled balance never fell below 477.38 CPU-seconds. The enclosing whole-machine counter interval averaged 4.01% CPU, below the 6.25% sustained ceiling.

The tick-local player roster and private CPU profiler from the original phase remain. Release 109 also deploys the two pending replication optimizations: immutable reuse of unchanged asteroid segment arrays and a cached spatial candidate index. Five-sample local comparisons measured 32.9% less asteroid preparation time and 8.4% less sparse replication time. These are controlled microbenchmark results, not claims of matching live CPU reductions. Some current live CPU cases are higher than the earlier captures; their world and target histories differ.

Production builds, all 121 Node tests and the Go package tests, lint, Go formatting, the complete local matrix, and local/live four-browser latency checks passed. Benchmark definitions, gameplay tuning, simulation and snapshot timing, client code, and Machine sizing were preserved. The local world was reset once; the live world was preserved.

The largest case, 32-player mining, still used 15.97% machine CPU and depends on burst credit. The actual suite started about 55 minutes after deployment; a conservative replay from the credit observed just before the ten-minute mark also stays positive, with a 106.94 CPU-second margin after sampling allowances. That replay is an inference, not a separate exact-ten-minute run. Strict cadence still failed: isolated delivery gaps and rare tick overruns remain. The original 25% reduction and below-quota peak targets remain unmet and are superseded by the updated criterion below.

The subsequent [release 110 smoothness follow-up](#smoothness-follow-up-release-110) removes an unnecessary background-checkpoint snapshot hold and adds rendered-browser input, flight, and real-mining checks alongside 32 independent miners. The full default-suite quota qualification above remains specifically release 109; targeted follow-up results are recorded separately.

## Objective and Machine Limit

### Updated acceptance criterion (continued investigation)

The current objective is to finish the unchanged default server CPU suite
(all five workloads at 4, 8, 16, and 32 players) without exhausting burst
credit or increasing Fly's CPU throttle counter. Individual 32-player cases
do not have to stay below 6.25% machine CPU. Do not change the suite, lower
simulation or snapshot cadence, or increase the Machine size to achieve this.
Validate candidates locally before deploying. After a live restart or update,
wait at least ten minutes before starting live load; also record actual balance,
because elapsed time alone does not establish available credit.

The current repository instructions require preserving the live world during
benchmarking; a live reset requires an explicit user request. The user explicitly
authorized resets for the October 28 SQLite comparisons while nobody is
playing; those resets and cooldowns are recorded in the follow-up report. Local extensive
benchmark sessions start with one reset before the complete matrix.

Fly exposes `fly_instance_cpu_balance` and `fly_instance_cpu_throttle` in
centiseconds, and `fly_instance_cpu_baseline` in CPU-equivalents ([metric
definitions](https://fly.io/docs/monitoring/metrics/)). Capture the counters
through preparation, warmup, measurement, and cleanup, not just the 30-second
measurement windows. Verify Machine identity and counter continuity. A nonzero
historical throttle total alone does not establish throttling during a new run;
the counter must increase during that run.

The Fly machine is one `lhr` Machine with two shared vCPUs and 512 MiB RAM. Its current Go memory budget is `GOMEMLIMIT=300MiB`; the tested runtime used Go's default `GOGC=100`. The world is stored on the attached `/data` volume.

Fly's current shared-CPU balance provides about 0.125 sustained CPU-equivalents for the whole machine. Because machine CPU percentages are averaged over two vCPUs, that is a 6.25% machine-CPU ceiling:

| Measure                   |                 Value |
| ------------------------- | --------------------: |
| Shared vCPUs              |                     2 |
| Sustained CPU quota       | 0.125 CPU-equivalents |
| Whole-machine CPU ceiling |                 6.25% |

A live machine CPU percentage is not a Go-process percentage: it includes the OS and other machine work. To convert a machine percentage to CPU-equivalents for this two-vCPU machine, multiply by 2 and divide by 100. Local Go-process CPU, local host CPU, and Fly machine CPU are distinct scopes and should not be substituted for one another.

No machine size, memory, `GOGC`, or `GOMEMLIMIT` settings were changed during this investigation. Earlier releases preserved the live world; the explicitly authorized release-113 comparison reset it. Benchmark runs create accounts and alter ordinary world state, so later live captures do not have an identical terrain/player history to earlier captures.

## Benchmark Method and Qualification

The server CPU suite uses real binary-protocol clients. It has five workloads: `convoy`, `spread`, `contact`, `module`, and `weapon`. The standard measurement is 15 seconds of warmup and 30 seconds of work. The module case discovers independent real asteroids, approaches them, and drills. The weapon case equips ships normally and fires a balanced set of loadouts.

The benchmark deliberately reports workload/client validity separately from strict server cadence. A case can have valid client work and a usable CPU counter while still failing cadence checks for skipped/coalesced tick states or snapshot gaps. Every case in the final 16- and 32-player matrices passed client/workload validation, but every case failed the strict cadence check. CPU values below are workload measurements, not a claim that cadence was healthy.

The live suite measures whole-Fly-machine CPU. Local suite runs use two server cores, a fresh local world, and isolated Go-process counters in addition to host CPU. Earlier live runs preserved their world; the release-113 follow-up records its authorized resets. See the [benchmark instructions](../benchmarking/README.md) for workload definitions and measurement semantics.

## Final Live CPU Matrices

These full matrices were collected on release 107, image `deployment-01M5XT2YGW3B0CWXD7QDX08HFB`, on October 27. Each row is one 30-second workload capture. All ten rows have `valid=true` and `clientValidation=true`; all ten have `serverCadence=false`.

| Players | Workload | Machine CPU | CPU-equivalents | vs. 6.25% ceiling              |
| ------: | -------- | ----------: | --------------: | ------------------------------ |
|      16 | convoy   |       2.10% |          0.0420 | below                          |
|      16 | spread   |       3.20% |          0.0640 | below                          |
|      16 | contact  |       3.67% |          0.0734 | below                          |
|      16 | module   |       7.03% |          0.1407 | above                          |
|      16 | weapon   |       3.67% |          0.0733 | below                          |
|      32 | convoy   |       3.33% |          0.0667 | below                          |
|      32 | spread   |       6.13% |          0.1227 | nominally below, little margin |
|      32 | contact  |       7.77% |          0.1553 | above                          |
|      32 | module   |      13.77% |          0.2753 | above                          |
|      32 | weapon   |       6.30% |          0.1260 | above                          |

At 16 players, module work alone exceeded the sustained quota. At 32 players, contact, module, and weapon workloads exceeded it; spread was just below it in this sample. The 32-player module case used about 2.20 times the current quota. Reducing that workload by 25% would still leave roughly 0.206 CPU-equivalents, above 0.125.

Raw captures: [16-player matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix16.json.gz) and [32-player matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix32.json.gz).

## Repeated Live Comparisons

The final convoy comparison used matching whole-machine CPU scopes and client-valid samples, but the captures were sequential rather than simultaneous and the world evolved between releases. It is useful evidence of direction, not a controlled laboratory A/B:

|                         Release | Samples | Mean machine CPU | Client-valid samples | Cadence       |
| ------------------------------: | ------: | ---------------: | -------------------: | ------------- |
| 104, before roster optimization |       3 |            3.89% |                  3/3 | failed in all |
|       105, first roster version |       3 |            3.41% |                  3/3 | failed in all |
|  106, event-path roster version |       5 |            3.61% |                  5/5 | failed in all |
|       107, final roster version |       5 |            3.37% |                  5/5 | failed in all |

The final convoy mean is 13.2% below the release 104 mean. Sample variability is material, and the event-path-only release 106 mean was higher than release 105. The result supports a modest convoy saving, not a 25% all-workload saving.

The module comparisons are noisier and each is a single sample:

| Release | Change state                             |                                         Machine CPU | Client valid | Cadence |
| ------: | ---------------------------------------- | --------------------------------------------------: | ------------ | ------- |
|     105 | roster change, before event-path lookups |                                              10.90% | yes          | failed  |
|     106 | event-path roster lookups                |                                              12.30% | yes          | failed  |
|     107 | final deployed roster                    | 12.40% in a targeted run; 13.77% in the full matrix | yes          | failed  |
|     108 | CPU profiler active during the workload  |                                              13.01% | yes          | failed  |

The release 108 value is profiled and must not be used as an unprofiled performance measurement. The full 16/32 matrices were on release 107; release 108 added the private profiling command. The live CPU profile below was captured on release 108.

Raw convoy captures: [release 104 baseline](../benchmarking/_local/cpu-2026-10-27/live-roster-before-convoy32.json.gz), [release 105](../benchmarking/_local/cpu-2026-10-27/live-roster-after-convoy32.json.gz), [release 106](../benchmarking/_local/cpu-2026-10-27/live-roster-after-events-convoy32-repeat.json.gz), and [release 107](../benchmarking/_local/cpu-2026-10-27/live-final-convoy32.json.gz). Targeted module captures: [release 105](../benchmarking/_local/cpu-2026-10-27/live-roster-module32-before-events.json.gz), [release 106](../benchmarking/_local/cpu-2026-10-27/live-roster-module32-after-events.json.gz), and [release 107](../benchmarking/_local/cpu-2026-10-27/live-final-module32.json.gz).

## Live CPU Profile

A bounded profiling command was added through the existing private Unix-domain maintenance socket. The public HTTP listener does not expose a pprof endpoint. `--cpu-profile-live=N` accepts 1–60 seconds, requires the game to be running, streams a base64-encoded pprof capture to the caller, and does not stop or restart the game or alter the database. Tests verify the running state and saved fixture remain unchanged. This diagnostic is in deployed release 108.

A 25-second profile was captured during the live 32-player module measurement. It contained 6.30 CPU-seconds of samples, or 25.2% of one core during the profiling interval. The profile is diagnostic: profiling adds overhead and its samples are not a profiler-free benchmark.

| Profile node                            | Flat CPU | Cumulative CPU | Interpretation                                                                         |
| --------------------------------------- | -------: | -------------: | -------------------------------------------------------------------------------------- |
| Linux `Syscall6`                        |    9.05% |          9.05% | Socket/syscall cost remains unavoidable for each recipient update.                     |
| `GameCollisions.Step`                   |    6.67% |         28.57% | Largest measured subsystem; includes the physics world step and collision record work. |
| `BinaryReplicationManager.encode.func1` |    5.40% |         21.90% | Per-entity membership, cadence, and record preparation.                                |
| `BinaryReplicationManager.encode`       |    1.43% |         26.51% | Total replication encoder path; overlaps the nested function above.                    |
| `simulation.UpdateEntities`             |    3.49% |          9.68% | Object and module simulation.                                                          |
| `GameCollisions.findFree`               |    1.90% |          3.02% | Sweep candidate broad-phase work.                                                      |

Cumulative percentages overlap and must not be added together. The profile did not show one isolated user-space function that could plausibly provide a clean 25% saving by itself.

Profile: [live 32-player module pprof](../benchmarking/_local/cpu-2026-10-27/live-module32.pprof), [collection window](../benchmarking/_local/cpu-2026-10-27/live-module32-profile-window.json), and [profiled benchmark report](../benchmarking/_local/cpu-2026-10-27/live-module32-profiled-retry.json.gz). A local 32-player mining profile is also available at [local module pprof](../benchmarking/_local/cpu-2026-10-27/local-module32-measured.pprof).

## Retained Optimization: Tick-Local Player Roster

The owner goroutine previously scanned the complete saved-player `OrderedMap` for many sector-local operations during every tick. Disconnected hidden ships remain resident for persistence, so the scan cost grows with dormant accounts even when only a few players are connected.

The retained change builds one roster at the start of `GameSession.Tick`, containing connected players and disconnected records whose ships are still visible. `sectorPlayers` reuses that list while the tick is active and filters by the player's current sector, so travel can move an entry between sectors immediately. Outside a tick, it retains the original full-registry behavior. Expiry still scans the registry and keeps its original rules. Tick-local lookups used for gate occupancy, progress, persistence attribution, and sounds were moved to the sector-aware helper where their semantics are sector-local.

The synthetic benchmark keeps 32 real connected ships and adds hidden dormant records with valid ship references. Each iteration acknowledges snapshots and ticks the full session. Against an overlay of the original implementation:

| Dormant records | Original mean tick | Roster mean tick |                                  Change |
| --------------: | -----------------: | ---------------: | --------------------------------------: |
|               0 |           224.3 µs |         220.8 µs | about 1.6% lower; within ordinary noise |
|           1,024 |           305.9 µs |         229.9 µs |                       about 24.8% lower |
|           8,192 |           913.0 µs |         259.1 µs |                       about 71.6% lower |

This explains why the change can help an aged world, but the live database record count was not exposed by the scratch image and was not measured. The large-record benchmark is not a claim that the current live database has 8,192 dormant players.

Correctness coverage checks connected, departing, and hidden records; travel to another sector; out-of-tick traversal; death-unlock persistence; and event attribution. The source is in [sectors.go](../src/server/network/sectors.go), [game-session.go](../src/server/network/game-session.go), [persistence.go](../src/server/network/persistence.go), and [world-sounds.go](../src/server/network/world-sounds.go). Benchmark and regression cases are in [replication-cache_test.go](../src/server/network/replication-cache_test.go).

## Original-Phase Experiments

The statuses in this table describe the original phase, before release 109.
The continued investigation validates and deploys the two retained replication
candidates; subsequent results are recorded separately below.

| Experiment                                                      | Evidence                                                                                                                                                                                                                                              | Decision/status                                                                                                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disable the Linux direct-send fast path                         | Local 32-player convoy Go-process CPU rose from 2.666% to 2.766% of one core, about 3.8% worse. The syscall work still exists in the queued writer.                                                                                                   | Rejected and reverted.                                                                                                                                                                          |
| Send normal snapshots every other tick (15 Hz)                  | Network tests failed for per-tick cadence, receipt recovery, join visibility, and input-edge timing.                                                                                                                                                  | Reverted; not benchmarked or deployed.                                                                                                                                                          |
| Prepare the entity upsert statement once per SQLite transaction | Existing eight-entity benchmark stayed about 3.3–3.4 ms/op; allocations changed only from about 646–647 to 643–644. CPU profile remained dominated by SQLite VM/WAL work and syscalls.                                                                | No material measured benefit; reverted.                                                                                                                                                         |
| Train PGO from the 32-player mining profile                     | On the 32-player session benchmark with zero dormant records, checked-in PGO averaged about 212.5 µs/tick; module-trained PGO averaged about 227.0 µs/tick, roughly 6.9% slower. Binary size decreased, but runtime did not improve.                  | Rejected; `default.pgo` unchanged.                                                                                                                                                              |
| Collision-neighbor cap                                          | Existing benchmark showed a small 16-object improvement, nearly no change at 32, and about 1–2% slower at 64; allocation cost increased at 64.                                                                                                        | No code change.                                                                                                                                                                                 |
| Reuse unchanged asteroid segment wire arrays                    | Local 256-asteroid preparation benchmark, with 32 health changes: about 140.4 µs, 133 KB and 2,722 allocations before; about 90.2 µs, 50.8 KB and 97 allocations after. Reuse is gated on exact element equality and does not mutate prior snapshots. | Present in the worktree, not live-tested or deployed. Exact-wire regression tests cover health, contents, outline, mass, max health, reorder, append, remove, and clear.                        |
| Shared spatial candidate index for sparse replication           | A 32-observer/4,096-entity sparse synthetic benchmark: original scan about 565 µs; naive grid rebuild about 627 µs (regression); cached grid about 491–515 µs (roughly 9–13% lower than baseline).                                                    | Present in the worktree, not live-tested or deployed. Exact packet comparison covers cell/range boundaries, markers, add/remove/replace, nonfinite coordinates, and stale owned-ship positions. |

The spatial filter is used only for large sparse same-world views with enough players and ordinary ranges. It uses 3,000-unit cells, reuses buckets while membership/cell assignments remain stable, always includes station markers and the observer's own ship, then applies the existing exact distance, membership, unload-range, and cadence rules. Unsupported views, ranges, or nonfinite coordinates fall back to the existing scan. These are implementation claims, not live validation results.

## Original-Phase Validation and State

On deployed release 108, production build, all 121 tests, lint, Go formatting, focused network tests, and the private profile round trip passed. The full 16/32 matrices were collected on release 107. No client source changed, and there was no dedicated four-browser latency or renderer-FPS run for the later local replication experiments. Server benchmark client validation and input acknowledgments passed, but strict cadence did not.

At the end of the original phase, the worktree contained additional un-deployed edits in `binary-replication.go`, `replication-common.go`, and `replication-cache_test.go` for the segment-array and spatial-candidate experiments, alongside the deployed roster/profile changes. Focused exactness tests and sparse benchmarks had passed after the spatial changes, but the complete validation gates and live comparisons remained outstanding. Release 109 subsequently passed the production build, all 121 tests, lint, and Go format checks before deployment; its benchmark evidence is recorded in the continued investigation.

No `fly.toml` sizing change was made. With the measured 32-player module demand of about 0.275 CPU-equivalents, six shared vCPUs would provide an estimated 0.375 CPU-equivalents and put that sample around 73% of its sustained quota. This is a capacity estimate, not a guarantee for mixed workloads. The user explicitly declined that sizing change; the live machine remains at two shared vCPUs.

## Raw Captures

All captures are in the ignored `benchmarking/_local/cpu-2026-10-27/` directory:

- [Final 16-player live matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix16.json.gz)
- [Final 32-player live matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix32.json.gz)
- [Final repeated 32-player convoy](../benchmarking/_local/cpu-2026-10-27/live-final-convoy32.json.gz)
- [Local aged-registry benchmark](../benchmarking/_local/cpu-2026-10-27/local-profile-module32.json.gz)
- [Original registry comparison overlay](../benchmarking/_local/cpu-2026-10-27/original-overlay.json)
- [SQLite baseline/experiment profile](../benchmarking/_local/cpu-2026-10-27/sqlite-prepared.pprof)
- [Private profiling capture wrapper](../benchmarking/_local/cpu-2026-10-27/profile-live-module.ts)

## Continued Investigation: Release 109

### Deployment and validation

Release 109 deploys the two replication candidates from the original phase.
The spatial index only prunes candidates before the original exact membership
and cadence decisions; segment-array reuse requires exact contents and outline
equality and retains immutable earlier snapshots. No gameplay tuning, tick rate,
snapshot rate, client code, Machine sizing, or benchmark source changed.

Production builds before and after validation passed. All 121 Node tests and
the Go package tests passed, including exact packet and segment mutation
regressions. Lint and Go formatting passed. The formatting fix adds only two
blank lines in `replication-cache_test.go`. Client asset names and sizes are
unchanged from the initial build; the stripped production server is 13,754,528
bytes. [Artifact hashes](../benchmarking/_local/cpu-2026-10-27/continued-artifacts.sha256)
identify the deployed build.

The local watcher was absent at the start of this session. The local world was
reset once, then the normal Go watcher and Vite services were started, with
`GOMEMLIMIT=300MiB` and default `GOGC=100`. The default local server CPU matrix
runs with `--cores 2`, 15 seconds of warmup, and 30 seconds of measurement.
The live world was preserved.

Deployment completed on the existing `8ed9e11b37e078` Machine, with a start event
at **11:35:47 UTC** on October 27. The earliest permitted live benchmark start
was **11:45:47 UTC**. The 11:46:11 UTC read-only check showed approximately
170.44 CPU-seconds of balance and a zero throttle counter. The reset balance
was approximately 100 CPU-seconds on this deployment; use measured credit
rather than assuming a fixed initial value.

Deployment evidence: [deployment log](../benchmarking/_local/cpu-2026-10-27/continued-deploy.log),
[Machine identity](../benchmarking/_local/cpu-2026-10-27/continued-machine-after-deploy.json),
and [cooldown counter capture](../benchmarking/_local/cpu-2026-10-27/continued-quota-cooldown.json).

### Complete local matrix and clean repeat

The unchanged default matrix completed all 20 cases. Every case passed workload,
client-consumption, and generator-headroom validation; no input acknowledgments
remained missing, and cleanup completed without errors. Every case still failed
strict cadence because isolated intermediate tick states were missing. Across
the matrix, the worst-client snapshot-gap p95 remained below 35 ms; the largest
observed gap was approximately 71 ms. Periodic local server-load summaries
reported no catch-up batches or ticks exceeding the simulation step.

These are **Go-process percentages of one local core**, not Fly whole-machine
percentages. The first four-player convoy measurement overlapped the initial
test run; exclude that capture from CPU comparisons. A clean targeted repeat
after the matrix passed and supplies the four-player convoy value below.
The repeat shares the evolved local world rather than reproducing its initial
terrain history.

| Players | Convoy | Spread | Contact | Module | Weapon |
| ------: | -----: | -----: | ------: | -----: | -----: |
|       4 |  0.63% |  0.83% |   1.00% |  1.57% |  0.77% |
|       8 |  0.87% |  1.27% |   1.70% |  2.36% |  1.36% |
|      16 |  1.43% |  1.96% |   2.62% |  4.23% |  2.13% |
|      32 |  2.73% |  3.73% |   4.83% |  8.72% |  4.70% |

Captures: [complete local matrix](../benchmarking/_local/cpu-2026-10-27/continued-local-baseline.json.gz),
[clean convoy repeat](../benchmarking/_local/cpu-2026-10-27/continued-local-convoy4-clean.json.gz),
and [matrix summary](../benchmarking/_local/cpu-2026-10-27/continued-local-summary.jsonl).
The file named `continued-local-baseline` contains the release-109 candidate
implementation, not an original-code baseline.

### Repeated local optimization comparison

After the matrix, five 500 ms samples per benchmark compared the deployed
candidate with an overlay restoring the original segment-copy behavior and
disabling the spatial candidate filter. Both variants used `CGO_ENABLED=0`,
`GOEXPERIMENT=simd`, `GOMAXPROCS=2`, `GOMEMLIMIT=300MiB`, and default `GOGC=100`.
No CPU suite measurement ran concurrently.

| Synthetic workload                           | Reference mean | Candidate mean | Time reduction | Reference allocations | Candidate allocations |
| -------------------------------------------- | -------------: | -------------: | -------------: | --------------------: | --------------------: |
| Prepare 256 asteroids, changing health on 32 |   121.66 µs/op |    81.69 µs/op |          32.9% |            2,724.4/op |               99.2/op |
| 32 observers, 4,096 sparse entities          |   562.24 µs/op |   515.23 µs/op |           8.4% |               51.8/op |               48.0/op |

Asteroid preparation allocated about 133.5 KB/op in the reference and 50.9 KB/op
in the candidate. These are elapsed-time and allocation microbenchmarks, not
measurements of live CPU savings. The two optimizations cannot be credited with
the same percentage reduction in a full game workload.

Evidence: [reference samples](../benchmarking/_local/cpu-2026-10-27/continued-micro-reference.txt),
[candidate samples](../benchmarking/_local/cpu-2026-10-27/continued-micro-current.txt),
[summary](../benchmarking/_local/cpu-2026-10-27/continued-micro-summary.json),
and [reference overlay](../benchmarking/_local/cpu-2026-10-27/continued-reference/overlay.json).

### Four-browser local latency

The unchanged local latency suite passed all five steering and five firing
trials with one actor and three observers, using the built production client.
All requested acknowledgments and steering, projectile, and muzzle draw
observations were received. Browser-health checks passed. Maximum cross-client
clock uncertainty was 0.57 ms.

| Endpoint, measured from input send                  | Steering mean | Firing mean |
| --------------------------------------------------- | ------------: | ----------: |
| Decoded authoritative acknowledgment                |      19.26 ms |    19.50 ms |
| Completed local game draw                           |       9.20 ms |    10.72 ms |
| Per-trial average of three completed observer draws |      32.25 ms |    28.35 ms |

Firing projectile and muzzle endpoints had the same means in this capture.
Five trials are a health check, not a controlled estimate of a small latency
change. These timings end at decoded acknowledgments or completed game draws,
not exact server-apply time or physical display scanout.
[Local latency capture](../benchmarking/_local/cpu-2026-10-27/continued-latency-local.json.gz).

### Live full-suite run

The unchanged live matrix started after local validation, approximately 55
minutes after release 109 started. The read-only pre-run capture showed about
475 CPU-seconds of credit and a zero throttle counter. The 10-minute minimum
wait was satisfied; this is not a test starting with exactly ten minutes of
credit. No live world reset or Machine configuration change was made.
The two local services started for this investigation were stopped after local
testing; the live server remains running.

[Pre-run Machine identity](../benchmarking/_local/cpu-2026-10-27/continued-machine-before-live.json)
and [pre-run quota counters](../benchmarking/_local/cpu-2026-10-27/continued-quota-before-suite.json)
record the starting conditions. The command completed all 20 cases without
interruption or cleanup errors. Every case passed workload, client-consumption,
and generator-headroom validation, with no missing input acknowledgments.

These are **whole-Fly-machine CPU percentages averaged over both vCPUs**,
including the OS. Each cell is one standard 30-second measurement, with no
active CPU profiler.

| Players | Convoy | Spread | Contact | Module | Weapon |
| ------: | -----: | -----: | ------: | -----: | -----: |
|       4 |  1.37% |  1.47% |   2.10% |  3.07% |  1.87% |
|       8 |  1.40% |  2.23% |   2.33% |  5.07% |  2.60% |
|      16 |  1.57% |  4.43% |   4.30% | 10.50% |  3.87% |
|      32 |  3.83% |  5.43% |   7.60% | 15.97% |  8.60% |

The 16-player module case and the 32-player contact, module, and weapon cases
exceed the 6.25% sustained ceiling. Their bursts did not exhaust credit during
the complete mixed suite. These results do not establish that continuously
running those workloads would stay within the sustained quota.

[Complete live matrix](../benchmarking/_local/cpu-2026-10-27/continued-live-matrix.json.gz),
[case summary](../benchmarking/_local/cpu-2026-10-27/continued-live-summary.jsonl),
and [execution interval](../benchmarking/_local/cpu-2026-10-27/continued-live-window.json).

Historical release-107 captures are not controlled live A/B measurements of
these two caches. Some release-109 CPU values are higher. For example, the
16-player module case measured 10.50% machine CPU versus the earlier 7.03%.
The retained target data shows different physical work: the mining-anchor
bounding rectangle expanded from approximately 31.8 × 13.9 thousand units to
35.3 × 25.9 thousand units, and attributed fractures increased from 74 to 81.
Mean initial target radius was similar (151.2 versus 150.0 units); aggregate
snapshot bytes actually fell from 23.43 MB to 21.32 MB. These observations do
not establish the cause of the CPU difference. They show why neither a live
saving nor a live regression should be attributed to the caches from these
unmatched samples alone. The controlled evidence is the local microbenchmark
comparison; the operational acceptance evidence is the complete live quota
trace. [Workload composition comparison](../benchmarking/_local/cpu-2026-10-27/continued-module16-composition.json).

### Complete quota audit and shorter-wait replay

The audit verifies all 20 default cases and their standard settings, the same
Machine instance and image throughout, unchanged VM sizing, valid clients and
headroom, and counter histories bracketing the entire command. The observed
command interval was **12:30:30.727–13:42:40.045 UTC**. The last workload
measurement ended at 13:41:57.485; the later boundary conservatively includes
cleanup and the time before completion was observed.

| Quota measure                    |                Result |
| -------------------------------- | --------------------: |
| Sustained allowance              | 0.125 CPU-equivalents |
| Bracketing balance samples       |                   291 |
| Largest balance sample gap       |              20.021 s |
| Starting/minimum sampled balance |    477.38 CPU-seconds |
| Maximum sampled balance          |    672.80 CPU-seconds |
| Ending sampled balance           |    668.95 CPU-seconds |
| Throttle counter, start → end    |         0.00 → 0.00 s |
| Throttle-counter increase        |            **0.00 s** |

The balance samples cover 12:30:27.594–13:42:57.590 UTC, extending beyond both
command boundaries. The separate enclosing CPU-counter interval is
12:30:01.545–13:43:16.545 UTC: 352.50 CPU-seconds over 4,395 seconds,
or **4.01% whole-machine CPU**. Even charging all that CPU to the shorter
observed command interval gives an upper bound of 4.08%. Neither interval
includes the 55-minute pre-run credit-building wait. Steal time (2.54 CPU-seconds)
and I/O wait (1.65 CPU-seconds) are retained separately from busy CPU.

The actual run began with more credit than would be available immediately after
the minimum wait. To assess that distinction, the audit replays the recorded
net balance changes from **166.94 CPU-seconds**, observed 590.216 seconds after
the restart. It deducts 19.57 CPU-seconds for a worst-case two-vCPU burst between
that sample and the exact ten-minute mark, 0.39 for possible pre-command edge
accrual, and 40.04 for a worst-case two-vCPU burst across the largest unsampled
balance interval. The resulting conservative minimum is **106.94 CPU-seconds**,
still above zero.

This is an inference for the same recorded CPU demand and baseline, not an
independent run beginning after exactly ten minutes. It uses Fly's documented
pooled quota and accrual/spending of unused CPU time; replaying the observed
increments from lower credit is conservative if actual accrual hit an upper
cap ([CPU performance](https://fly.io/docs/machines/cpu-performance/)). It
supports the ten-minute wait for this measured suite without treating the
longer actual wait as the only evidence.

Evidence: [raw CPU/quota history](../benchmarking/_local/cpu-2026-10-27/continued-quota-complete-suite.json),
[audit result](../benchmarking/_local/cpu-2026-10-27/continued-quota-audit.json),
[audit script](../benchmarking/_local/cpu-2026-10-27/audit-live.ts),
and [post-suite Machine identity](../benchmarking/_local/cpu-2026-10-27/continued-machine-after-live.json).

### Remaining cadence findings

All 20 live cases still failed strict cadence. The worst-client snapshot-gap
p95 was 41.42 ms in 32-player contact. The largest isolated delivery gap was
245.14 ms in four-player weapons, despite that case using only 1.87% machine
CPU. The largest observed input acknowledgment was 254.75 ms, also in
32-player contact; all acknowledgments eventually arrived.

In eight-player contact, each client missed one intermediate tick state, with
no missing-state pair shared by all clients. Its largest skipped-state gap was
about 68 ms, whereas its largest delivery gap was 178 ms. These observations
distinguish skipped states from longer delivery silences; they do not identify
the cause of the latter.

The periodic live summaries at 13:26 and 13:36 each recorded one tick call over
the 33.33 ms step, with maxima of 45.05 and 37.41 ms respectively. The first
window also had two catch-up calls spanning three ticks. These happened with a
zero quota-throttle counter. Quota throttling is therefore not an explanation
for all observed cadence problems, and this work does not claim to have
eliminated jank. [Live server log](../benchmarking/_local/cpu-2026-10-27/continued-live-final-server.log).

### Four-browser live latency

The unchanged live latency suite passed all five steering and five firing
trials. Every requested acknowledgment and steering, projectile, and muzzle
draw observation was received; browser-health checks passed. Maximum
cross-client clock uncertainty was 0.54 ms.

| Endpoint, measured from input send                  | Steering mean | Firing mean |
| --------------------------------------------------- | ------------: | ----------: |
| Decoded authoritative acknowledgment                |      36.24 ms |    27.78 ms |
| Completed local game draw                           |       5.66 ms |    10.04 ms |
| Per-trial average of three completed observer draws |      48.47 ms |    34.46 ms |

Projectile and muzzle firing means matched in this capture. These are small
four-browser health samples, not a latency A/B study or a four-browser test
under additional 32-player load. The CPU suite separately retains input
acknowledgment and snapshot timing for its actual 32-player clients.
[Live latency capture](../benchmarking/_local/cpu-2026-10-27/continued-latency-live.json.gz).

The post-latency quota check also retained a zero throttle counter. Final
Machine checks passed on the same release, image, instance, and VM settings.
Artifact hashes still matched the tested deployment. Temporary local services
and benchmark browser contexts were closed; the live server remains running.
[Post-latency quota capture](../benchmarking/_local/cpu-2026-10-27/continued-quota-after-latency.json)
and [final Machine state](../benchmarking/_local/cpu-2026-10-27/continued-machine-final.json).

## Smoothness Follow-up: Release 110

A cadence failure is a warning about authoritative delivery, not a measurement
of a frozen rendered frame. The client predicts local input and moving bodies
between 30 Hz snapshots, renders on `requestAnimationFrame`, and eases
reconciliation error without adding a snapshot interpolation buffer. Its
60-tick prediction limit is a two-second outage ceiling, not an added input
delay or an acceptable latency target. Short delivery gaps can therefore leave
ordinary flight continuous; delayed collision/mining outcomes and corrections
can still be visible or felt. Zero quota throttling alone does not establish a
smooth client experience.

The release 109 default suite's **32-player mining** case had worst-client
snapshot-gap p95 37.04 ms, maximum 87.88 ms, and worst-client input-ACK p95
50.59 ms, maximum 83.13 ms, with no missing acknowledgments. Its snapshot rates
were 29.98–30.01 Hz. The 245 ms snapshot maximum reported across the whole suite
belonged to the four-player weapon case; it was not the 32-player mining
maximum. The previous light-load four-browser latency check did not establish
client smoothness while 32 miners were active.

### Confirmed checkpoint delivery hold

Periodic player checkpoints used the same snapshot durability barrier as
purchases and rewards. A background pose/fuel save therefore held that player's
snapshots until SQLite committed, even though normal flight snapshots already
expose those continuously changing values between saves. Checkpoints are
staggered, explaining why isolated missing ticks need not be a global server
stall.

Release 110 marks background checkpoint entries as nonblocking while still
capturing and submitting them to the same persistence queue. Pending gameplay
saves retain their blocking flag and commit sequence. This changes neither
save frequency nor simulation/snapshot timing, and adds no client buffering.
A real SQLite write-lock regression test reproduces the prior delivery pause,
checks that snapshots continue with the fix, and verifies the saved ship pose
after commit. Separate before/after ordering cases verify that a checkpoint
cannot release an uncommitted gameplay save.

Production builds before and after, all 121 Node tests, Go package tests,
lint, and Go formatting passed. Client resource names and byte sizes were
identical across the builds (all 14 client artifact hashes also match release 109);
the stripped server remains 13,754,528 bytes. Release 110 started at **15:33:33.519 UTC** on
the existing Machine; no live load was started during its ten-minute cooldown.
The live world, two-vCPU/512-MiB sizing, and `GOMEMLIMIT=300MiB` were preserved.

### Rendered-client diagnostic method

The default CPU and latency suites are unchanged. A separate diagnostic in
`benchmarking/_local/smoothness-2026-10-27/` coordinates the existing module
workload with a production browser. It requests a 120-second mining window,
uses 20 trusted steering and 20 trusted firing trials, then records ordinary
flight and actual asteroid drilling. The coordinator requires every trial,
flight, and drilling capture to fall inside the protocol clients' measured
mining window. This is additional targeted coverage, not a rerun of the default
20-case CPU suite.

The realistic single-browser case has **33 total clients**: 32 protocol miners
at independent real rocks plus one rendered browser pilot. Browser preparation
uses public profile/play, real docking, normal purchases/equipment, and launch.
The navigation pilot uses normal controls and existing mining approach logic,
including the fitted drill geometry. Read-only probes record actual rendered
ship poses, frame intervals, callback/message-handler time, prediction lead,
and reconciliation offsets; they do not inject positions, health, or fuel.
The mining inspector reads existing cached geometry and does not invoke the
lazy segment getter. Earlier exploratory captures that forced that getter or
failed mining/navigation qualification are not healthy mining evidence.

A four-browser/32-miner local diagnostic qualified the protocol workload and
all 40 input trials. Local steering draw averaged 7.70 ms (maximum 22.80 ms),
remote paired draw 43.70 ms (maximum 56.50 ms), and authoritative ACK 28.14 ms
(maximum 40.30 ms). It also recorded rare 90–100 ms frame gaps with four browser
windows sharing the test host, motivating a single-browser comparison rather
than attributing those gaps to the server. That exploratory drilling pilot did
not sustain the required contact duration.

The corrected single-browser quiet local baseline qualified all 40 trials and
recorded 15.01 seconds after initial drilling contact, with 26 observed damage
changes. Steering/fire local draw averages were 7.46/8.24 ms, and ACK averages
27.84/29.34 ms. Input-phase frame-gap p99 was 8.40 ms; its maximum was 50.00 ms.
The two-second flight sample had a maximum 8.50 ms frame interval and no
rendered stop while moving. Drilling frame-gap p99 was 8.50 ms, maximum 58.30 ms,
with one gap over 50 ms in that 15-second sample. The prediction horizon was
never exhausted. These isolated stalls also occur without 32-player load and
remain relevant to any claim of perfectly consistent presentation.

Evidence: [quiet single-browser capture](../benchmarking/_local/smoothness-2026-10-27/quiet-single-local-v3.json.gz),
[phase/motion analysis](../benchmarking/_local/smoothness-2026-10-27/quiet-single-local-v3-motion.json),
[earlier four-browser loaded capture](../benchmarking/_local/smoothness-2026-10-27/local-loaded/latency.json.gz),
and [its 32-miner workload](../benchmarking/_local/smoothness-2026-10-27/local-loaded/mining.json.gz).

### Qualified local 33-client result

The coordinated single-browser local run completed and passed both workload
and browser validity. All 40 trusted trials, the flight sample, and a 15.07-second
mining-contact capture (23 observed damage changes) fell within the 32 protocol
miners' 120-second measurement window. Each input endpoint had 20/20 observed
responses and no misses.

| Measure                                    |      Quiet local | 32 miners + browser locally |
| ------------------------------------------ | ---------------: | --------------------------: |
| Steering local draw, mean / maximum        |  7.46 / 15.50 ms |             6.56 / 10.60 ms |
| Fire local draw, mean / maximum            |  8.24 / 15.10 ms |             8.08 / 15.20 ms |
| Steering authoritative ACK, mean / maximum | 27.84 / 43.00 ms |            34.38 / 49.30 ms |
| Fire authoritative ACK, mean / maximum     | 29.34 / 44.30 ms |            34.95 / 53.30 ms |
| Input-phase frame gap, p99 / maximum       |  8.40 / 50.00 ms |             8.40 / 49.90 ms |
| Drilling frame gap, p99 / maximum          |  8.50 / 58.30 ms |             8.40 / 16.70 ms |
| Flight frozen rendered pose while moving   |             0 ms |                        0 ms |

The two-second loaded flight sample did have one 41.60 ms frame interval;
prediction continued moving the ship on the next rendered frame. The complete
loaded browser capture, including navigation, had an 83.30 ms maximum frame gap
and two additional 50 ms gaps. These are potentially visible presentation
hitches, even though input and contact-phase results were responsive. The
largest gap was outside the drilling/contact phase; adjacent game callbacks
were 4.5 and 12.5 ms and the inspection itself took at most 0.5 ms. These
measurements do not identify the scheduling/GPU/GC cause, and do not justify
blaming or dismissing it as a server tick stall. The local prediction lead
stayed at most one tick; observed own-ship reconciliation displacement was
below one millionth of a world unit.

The protocol clients had worst-client snapshot-gap p95 34.88 ms, maximum
67.57 ms, and rates 30.00–30.00 Hz (rounded). Worst-client ACK p95 was 34.79 ms,
maximum 48.11 ms, with zero missing acknowledgments. Strict cadence still
failed on five isolated two-tick transitions, each affecting one client;
none was shared by all clients. The local ten-minute server-load intervals
through 15:50 UTC had no over-budget tick or catch-up call. The 120-second
Go-process counter used 10.43% of one core. Host CPU includes Chrome and
protocol generators and is not comparable to live whole-machine CPU.

Evidence: [combined qualification](../benchmarking/_local/smoothness-2026-10-27/local-single-loaded-v2/combined.json),
[browser capture](../benchmarking/_local/smoothness-2026-10-27/local-single-loaded-v2/latency.json.gz),
[motion analysis](../benchmarking/_local/smoothness-2026-10-27/local-single-loaded-v2/latency-motion.json),
and [32-miner capture](../benchmarking/_local/smoothness-2026-10-27/local-single-loaded-v2/mining.json.gz).

### Live 32-miner input/flight result and qualification limits

The preserved live world took approximately eight minutes to reserve and
approach 32 independent real targets. The measured window was
**16:08:02.547–16:10:02.560 UTC**. The extra browser's 40 trusted input trials,
flight, and subsequent survey all occurred inside that window. Local draw and
ACK responses were observed for 20/20 steering and 20/20 firing events:

| Live browser measure under 32-miner load |     Mean |  Maximum |
| ---------------------------------------- | -------: | -------: |
| Steering local draw                      |  5.64 ms |  8.80 ms |
| Fire local draw                          |  7.29 ms | 16.00 ms |
| Steering authoritative ACK               | 36.28 ms | 52.50 ms |
| Fire authoritative ACK                   | 29.09 ms | 48.80 ms |

Input-phase frame-gap p99 was 8.40 ms and maximum 50.00 ms. The flight sample
had p99 8.40 ms and maximum 25.00 ms, with no frozen rendered pose while moving.
Prediction led by at most two ticks; the largest observed own-ship correction
was 0.0109 world units and 0.00195 radians. There was no prediction-horizon
stall. This measures completed game draws, not physical display scanout or a
subjective human playtest.

The actual 32 protocol miners passed client/workload and generator-headroom
validation. **Strict server cadence also passed** in this two-minute window:
no skipped/coalesced tick states, snapshot rates 30.005 Hz, worst-client
snapshot-gap p95 36.86 ms and maximum 80.99 ms. All inputs were acknowledged;
worst-client ACK p95 was 49.62 ms, maximum 80.87 ms. A network arrival gap can
therefore exceed the nominal step even when all successive tick states arrive.
These are targeted observations, not proof that every world state or network
condition is free of a hitch.

Two limits prevent calling this a fully qualified combined live mining/CPU
capture:

- The extra rendered pilot found no clear intact-rock approach within its
  20-second outward survey. Its real drilling criterion failed. The healthy
  live browser evidence covers input, firing, flight, and survey while the
  **32 other clients really mined**; actual rendered drilling under load was
  qualified locally, not live.
- The CPU observer's initial metrics request succeeded, but its final request
  returned HTTP 403, so the original benchmark correctly retains
  `serverCpu.available=false` and `valid=false`. A separate fresh post-run
  request recovered raw counter samples at 16:08:17.462 and 16:10:02.469,
  wholly inside the active window. The existing CPU-window helpers compute
  **15.64% whole-machine CPU** over those 105.007 seconds (87.5% coverage).
  This supplementary result does not rewrite the original report or turn the
  failed combined diagnostic into a pass. No benchmark definitions changed.

A separate quota audit covers preparation through cleanup: minimum sampled
balance **230.36 CPU-seconds**, **zero throttle-counter increase**, and baseline
0.125 CPU-equivalents throughout that run. An unrelated zero balance/baseline
sample at 15:53:58 UTC preceded the test and is outside this audited interval.
Machine instance/image continuity and passing final health checks were verified;
release 110 remained on the same two-vCPU Machine. The live world was not reset.
All temporary browsers, generators, and local services from this investigation
were closed afterward.

**Conclusion:** current measurements support responsive input and continuous
predicted movement with 32 independent miners, and release 110 removes one
proven source of unnecessary delivery pauses without adding buffering or
slowing simulation. They do not justify a blanket “no jank” claim: isolated
50–83 ms rendered frame intervals remain in these captures, including a quiet
baseline, and live rendered drilling did not qualify. Further work on those
presentation tails needs client/host scheduling or GPU/GC attribution and a
live browser fixture that stages a reachable real mining target before the
measurement gate; quota success is not a substitute for that evidence.

Evidence: [live browser capture](../benchmarking/_local/smoothness-2026-10-27/live-single-loaded/latency.json.gz),
[motion analysis](../benchmarking/_local/smoothness-2026-10-27/live-single-loaded/latency-motion.json),
[original 32-miner capture](../benchmarking/_local/smoothness-2026-10-27/live-single-loaded/mining.json.gz),
[supplemental CPU/quota audit](../benchmarking/_local/smoothness-2026-10-27/live-audit.json),
and [raw post-run counters](../benchmarking/_local/smoothness-2026-10-27/quota-live-after.json).

The next phase investigates one-second background persistence batching and records the default-on blur setting in the [server persistence follow-up](server-persistence-investigation-2026-10-27.md). Server CPU is the priority for that phase.
