# Server CPU Investigation (October 27, 2026)

## Executive Summary

The investigation reduced live 32-player convoy CPU by about 13% in repeated samples, but did not meet the 25% goal. The 32-player module workload remains the largest measured case and is substantially above the current shared-CPU quota. The full live 16- and 32-player matrices also show the module workload above quota at both sizes; at 32 players, contact, spread, and weapon workloads are at or above the limit as well.

The main retained server optimization is a tick-local roster for active and still-visible ships. It avoids repeatedly walking every saved player while processing per-tick, sector-local work. A private maintenance command was added to capture a bounded CPU profile from the actual live Go process without exposing pprof on the public listener or stopping the game.

Two further local candidates are present in the current worktree but were not in the last deployed image: reusing unchanged asteroid segment wire arrays, and a shared spatial candidate index for sparse snapshot replication. Their local microbenchmarks look promising, but the latest worktree has not yet passed a complete build/test/lint gate after the final spatial edge-case changes, and neither candidate has been measured live. Do not treat either as deployed or as a live CPU saving.

The 25% CPU reduction target and the goal of operating all 32-player workloads below the current quota remain unmet.

## Objective and Machine Limit

The Fly machine is one `lhr` Machine with two shared vCPUs and 512 MiB RAM. Its current Go memory budget is `GOMEMLIMIT=300MiB`; the tested runtime used Go's default `GOGC=100`. The world is stored on the attached `/data` volume.

Fly's current shared-CPU balance provides about 0.125 sustained CPU-equivalents for the whole machine. Because machine CPU percentages are averaged over two vCPUs, that is a 6.25% machine-CPU ceiling:

| Measure | Value |
| --- | ---: |
| Shared vCPUs | 2 |
| Sustained CPU quota | 0.125 CPU-equivalents |
| Whole-machine CPU ceiling | 6.25% |

A live machine CPU percentage is not a Go-process percentage: it includes the OS and other machine work. To convert a machine percentage to CPU-equivalents for this two-vCPU machine, multiply by 2 and divide by 100. Local Go-process CPU, local host CPU, and Fly machine CPU are distinct scopes and should not be substituted for one another.

No machine size, memory, `GOGC`, or `GOMEMLIMIT` settings were changed during this investigation. The live world was not reset. Benchmark runs do create accounts and alter ordinary world state, so later live captures do not have an identical terrain/player history to earlier captures.

## Benchmark Method and Qualification

The server CPU suite uses real binary-protocol clients. It has five workloads: `convoy`, `spread`, `contact`, `module`, and `weapon`. The standard measurement is 15 seconds of warmup and 30 seconds of work. The module case discovers independent real asteroids, approaches them, and drills. The weapon case equips ships normally and fires a balanced set of loadouts.

The benchmark deliberately reports workload/client validity separately from strict server cadence. A case can have valid client work and a usable CPU counter while still failing cadence checks for skipped/coalesced tick states or snapshot gaps. Every case in the final 16- and 32-player matrices passed client/workload validation, but every case failed the strict cadence check. CPU values below are workload measurements, not a claim that cadence was healthy.

The live suite measures whole-Fly-machine CPU. Local suite runs use two server cores, a fresh local world, and isolated Go-process counters in addition to host CPU. The real live database and its world were preserved. See the [benchmark instructions](../benchmarking/README.md) for workload definitions and measurement semantics.

## Final Live CPU Matrices

These full matrices were collected on release 107, image `deployment-01M5XT2YGW3B0CWXD7QDX08HFB`, on October 27. Each row is one 30-second workload capture. All ten rows have `valid=true` and `clientValidation=true`; all ten have `serverCadence=false`.

| Players | Workload | Machine CPU | CPU-equivalents | vs. 6.25% ceiling |
| ---: | --- | ---: | ---: | --- |
| 16 | convoy | 2.10% | 0.0420 | below |
| 16 | spread | 3.20% | 0.0640 | below |
| 16 | contact | 3.67% | 0.0734 | below |
| 16 | module | 7.03% | 0.1407 | above |
| 16 | weapon | 3.67% | 0.0733 | below |
| 32 | convoy | 3.33% | 0.0667 | below |
| 32 | spread | 6.13% | 0.1227 | nominally below, little margin |
| 32 | contact | 7.77% | 0.1553 | above |
| 32 | module | 13.77% | 0.2753 | above |
| 32 | weapon | 6.30% | 0.1260 | above |

At 16 players, module work alone exceeded the sustained quota. At 32 players, contact, module, and weapon workloads exceeded it; spread was just below it in this sample. The 32-player module case used about 2.20 times the current quota. Reducing that workload by 25% would still leave roughly 0.206 CPU-equivalents, above 0.125.

Raw captures: [16-player matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix16.json.gz) and [32-player matrix](../benchmarking/_local/cpu-2026-10-27/live-final-matrix32.json.gz).

## Repeated Live Comparisons

The final convoy comparison used matching whole-machine CPU scopes and client-valid samples, but the captures were sequential rather than simultaneous and the world evolved between releases. It is useful evidence of direction, not a controlled laboratory A/B:

| Release | Samples | Mean machine CPU | Client-valid samples | Cadence |
| ---: | ---: | ---: | ---: | --- |
| 104, before roster optimization | 3 | 3.89% | 3/3 | failed in all |
| 105, first roster version | 3 | 3.41% | 3/3 | failed in all |
| 106, event-path roster version | 5 | 3.61% | 5/5 | failed in all |
| 107, final roster version | 5 | 3.37% | 5/5 | failed in all |

The final convoy mean is 13.2% below the release 104 mean. Sample variability is material, and the event-path-only release 106 mean was higher than release 105. The result supports a modest convoy saving, not a 25% all-workload saving.

The module comparisons are noisier and each is a single sample:

| Release | Change state | Machine CPU | Client valid | Cadence |
| ---: | --- | ---: | --- | --- |
| 105 | roster change, before event-path lookups | 10.90% | yes | failed |
| 106 | event-path roster lookups | 12.30% | yes | failed |
| 107 | final deployed roster | 12.40% in a targeted run; 13.77% in the full matrix | yes | failed |
| 108 | CPU profiler active during the workload | 13.01% | yes | failed |

The release 108 value is profiled and must not be used as an unprofiled performance measurement. The full 16/32 matrices were on release 107; release 108 added the private profiling command. The live CPU profile below was captured on release 108.

Raw convoy captures: [release 104 baseline](../benchmarking/_local/cpu-2026-10-27/live-roster-before-convoy32.json.gz), [release 105](../benchmarking/_local/cpu-2026-10-27/live-roster-after-convoy32.json.gz), [release 106](../benchmarking/_local/cpu-2026-10-27/live-roster-after-events-convoy32-repeat.json.gz), and [release 107](../benchmarking/_local/cpu-2026-10-27/live-final-convoy32.json.gz). Targeted module captures: [release 105](../benchmarking/_local/cpu-2026-10-27/live-roster-module32-before-events.json.gz), [release 106](../benchmarking/_local/cpu-2026-10-27/live-roster-module32-after-events.json.gz), and [release 107](../benchmarking/_local/cpu-2026-10-27/live-final-module32.json.gz).

## Live CPU Profile

A bounded profiling command was added through the existing private Unix-domain maintenance socket. The public HTTP listener does not expose a pprof endpoint. `--cpu-profile-live=N` accepts 1–60 seconds, requires the game to be running, streams a base64-encoded pprof capture to the caller, and does not stop or restart the game or alter the database. Tests verify the running state and saved fixture remain unchanged. This diagnostic is in deployed release 108.

A 25-second profile was captured during the live 32-player module measurement. It contained 6.30 CPU-seconds of samples, or 25.2% of one core during the profiling interval. The profile is diagnostic: profiling adds overhead and its samples are not a profiler-free benchmark.

| Profile node | Flat CPU | Cumulative CPU | Interpretation |
| --- | ---: | ---: | --- |
| Linux `Syscall6` | 9.05% | 9.05% | Socket/syscall cost remains unavoidable for each recipient update. |
| `GameCollisions.Step` | 6.67% | 28.57% | Largest measured subsystem; includes the physics world step and collision record work. |
| `BinaryReplicationManager.encode.func1` | 5.40% | 21.90% | Per-entity membership, cadence, and record preparation. |
| `BinaryReplicationManager.encode` | 1.43% | 26.51% | Total replication encoder path; overlaps the nested function above. |
| `simulation.UpdateEntities` | 3.49% | 9.68% | Object and module simulation. |
| `GameCollisions.findFree` | 1.90% | 3.02% | Sweep candidate broad-phase work. |

Cumulative percentages overlap and must not be added together. The profile did not show one isolated user-space function that could plausibly provide a clean 25% saving by itself.

Profile: [live 32-player module pprof](../benchmarking/_local/cpu-2026-10-27/live-module32.pprof), [collection window](../benchmarking/_local/cpu-2026-10-27/live-module32-profile-window.json), and [profiled benchmark report](../benchmarking/_local/cpu-2026-10-27/live-module32-profiled-retry.json.gz). A local 32-player mining profile is also available at [local module pprof](../benchmarking/_local/cpu-2026-10-27/local-module32-measured.pprof).

## Retained Optimization: Tick-Local Player Roster

The owner goroutine previously scanned the complete saved-player `OrderedMap` for many sector-local operations during every tick. Disconnected hidden ships remain resident for persistence, so the scan cost grows with dormant accounts even when only a few players are connected.

The retained change builds one roster at the start of `GameSession.Tick`, containing connected players and disconnected records whose ships are still visible. `sectorPlayers` reuses that list while the tick is active and filters by the player's current sector, so travel can move an entry between sectors immediately. Outside a tick, it retains the original full-registry behavior. Expiry still scans the registry and keeps its original rules. Tick-local lookups used for gate occupancy, progress, persistence attribution, and sounds were moved to the sector-aware helper where their semantics are sector-local.

The synthetic benchmark keeps 32 real connected ships and adds hidden dormant records with valid ship references. Each iteration acknowledges snapshots and ticks the full session. Against an overlay of the original implementation:

| Dormant records | Original mean tick | Roster mean tick | Change |
| ---: | ---: | ---: | ---: |
| 0 | 224.3 µs | 220.8 µs | about 1.6% lower; within ordinary noise |
| 1,024 | 305.9 µs | 229.9 µs | about 24.8% lower |
| 8,192 | 913.0 µs | 259.1 µs | about 71.6% lower |

This explains why the change can help an aged world, but the live database record count was not exposed by the scratch image and was not measured. The large-record benchmark is not a claim that the current live database has 8,192 dormant players.

Correctness coverage checks connected, departing, and hidden records; travel to another sector; out-of-tick traversal; death-unlock persistence; and event attribution. The source is in [sectors.go](../src/server/network/sectors.go), [game-session.go](../src/server/network/game-session.go), [persistence.go](../src/server/network/persistence.go), and [world-sounds.go](../src/server/network/world-sounds.go). Benchmark and regression cases are in [replication-cache_test.go](../src/server/network/replication-cache_test.go).

## Experiments

| Experiment | Evidence | Decision/status |
| --- | --- | --- |
| Disable the Linux direct-send fast path | Local 32-player convoy Go-process CPU rose from 2.666% to 2.766% of one core, about 3.8% worse. The syscall work still exists in the queued writer. | Rejected and reverted. |
| Send normal snapshots every other tick (15 Hz) | Network tests failed for per-tick cadence, receipt recovery, join visibility, and input-edge timing. | Reverted; not benchmarked or deployed. |
| Prepare the entity upsert statement once per SQLite transaction | Existing eight-entity benchmark stayed about 3.3–3.4 ms/op; allocations changed only from about 646–647 to 643–644. CPU profile remained dominated by SQLite VM/WAL work and syscalls. | No material measured benefit; reverted. |
| Train PGO from the 32-player mining profile | On the 32-player session benchmark with zero dormant records, checked-in PGO averaged about 212.5 µs/tick; module-trained PGO averaged about 227.0 µs/tick, roughly 6.9% slower. Binary size decreased, but runtime did not improve. | Rejected; `default.pgo` unchanged. |
| Collision-neighbor cap | Existing benchmark showed a small 16-object improvement, nearly no change at 32, and about 1–2% slower at 64; allocation cost increased at 64. | No code change. |
| Reuse unchanged asteroid segment wire arrays | Local 256-asteroid preparation benchmark, with 32 health changes: about 140.4 µs, 133 KB and 2,722 allocations before; about 90.2 µs, 50.8 KB and 97 allocations after. Reuse is gated on exact element equality and does not mutate prior snapshots. | Present in the worktree, not live-tested or deployed. Exact-wire regression tests cover health, contents, outline, mass, max health, reorder, append, remove, and clear. |
| Shared spatial candidate index for sparse replication | A 32-observer/4,096-entity sparse synthetic benchmark: original scan about 565 µs; naive grid rebuild about 627 µs (regression); cached grid about 491–515 µs (roughly 9–13% lower than baseline). | Present in the worktree, not live-tested or deployed. Exact packet comparison covers cell/range boundaries, markers, add/remove/replace, nonfinite coordinates, and stale owned-ship positions. |

The spatial filter is used only for large sparse same-world views with enough players and ordinary ranges. It uses 3,000-unit cells, reuses buckets while membership/cell assignments remain stable, always includes station markers and the observer's own ship, then applies the existing exact distance, membership, unload-range, and cadence rules. Unsupported views, ranges, or nonfinite coordinates fall back to the existing scan. These are implementation claims, not live validation results.

## Validation and Current State

On deployed release 108, production build, all 121 tests, lint, Go formatting, focused network tests, and the private profile round trip passed. The full 16/32 matrices were collected on release 107. No client source changed, and there was no dedicated four-browser latency or renderer-FPS run for the later local replication experiments. Server benchmark client validation and input acknowledgments passed, but strict cadence did not.

At the time of this report, the worktree contains additional un-deployed edits in `binary-replication.go`, `replication-common.go`, and `replication-cache_test.go` for the segment-array and spatial-candidate experiments, alongside the deployed roster/profile changes. Focused exactness tests and sparse benchmarks passed after the spatial changes, but a full production build, full suite, lint, Go format check, and live benchmark have not been rerun after the final spatial/stale-view edits. Do not deploy those experiments until those gates and workload-matched live comparisons pass.

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
