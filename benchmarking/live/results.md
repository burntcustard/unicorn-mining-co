# Live benchmark results

## 2 October 2026 at 14:50:45 BST

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 76.7                  | 101.0              | 6.0–28.5              |
| 8       | 30.00            | 71.0                  | 98.6               | 6.7–33.1              |
| 16      | 30.00            | 103.2                 | 146.6              | 8.9–81.6              |
| 32      | 29.98–30.09      | 316.4                 | 528.0              | 16.2–106.9            |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

## 2 October 2026 at 17:01:34 BST

Post-deployment run after merging `go-server` into `main` (`bc0237f`). Same browser, viewport, warmup and measurement durations as the earlier run; all 16 cases completed.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 37.9                  | 107.2              | 8.5–53.8              |
| 8       | 30.00            | 44.1                  | 63.1               | 10.4–93.0             |
| 16      | 29.98–30.02      | 123.5                 | 330.0              | 11.4–120.1            |
| 32      | 30.04–30.21      | 331.9                 | 1019.0             | 32.6–88.0             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

Module cases recorded 76, 975, 2,604 and 115 client exceptions at 4, 8, 16 and 32 players respectively, involving undefined `forEach`/`X` properties and `e.nt` not being a function. These errors limit module-workload comparisons. The other activities recorded no client exceptions.

## 2 October 2026 at 22:13:00 BST

Repeat run against the same deployed entry asset as the 17:01 run (`index-RaZVaM7F.js`), using Chrome 153.0.8010.12, a 320 × 200 viewport, 15 seconds of warmup and 60 seconds of measurement per case, and 120-second cooldowns between player counts. All 16 cases completed.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 36.5                  | 51.7               | 8.9–50.5              |
| 8       | 30.00–30.01      | 46.6                  | 109.2              | 8.7–95.5              |
| 16      | 29.98–30.03      | 126.1                 | 350.5              | 11.1–120.8            |
| 32      | 30.04–30.12      | 327.9                 | 1136.6             | 37.2–74.5             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

Module cases recorded 253, 1,634, 3,639 and 142 client exceptions at 4, 8, 16 and 32 players respectively. The 32-player contact case also recorded 192 client exceptions. Errors involved undefined `forEach`/`X` properties and `e.nt` not being a function, limiting comparisons for these cases. The remaining cases recorded no client exceptions.

## 3 October 2026 at 13:38:08 BST

Run against deployed entry asset `index-DHaB6QQo.js`, using Chrome 153.0.8010.12, a 320 × 200 viewport, 15 seconds of warmup and 60 seconds of measurement per case, and 120-second cooldowns between player counts. All 16 cases completed with no client exceptions.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 36.1                  | 63.4               | 8.5–49.0              |
| 8       | 30.00–30.04      | 43.5                  | 77.2               | 9.6–66.0              |
| 16      | 29.98–30.00      | 105.1                 | 207.1              | 10.8–156.9            |
| 32      | 30.09–30.11      | 323.5                 | 1142.8             | 34.8–99.9             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

## 5 October 2026 at 13:48:17 BST

Post-persistence run against deployed revision `5d3500c` (Fly release 44) and
entry asset `index-fr0pAOYG.js`. One London Machine used the `game_data` volume
and `/data/world.sqlite`. All 16 cases completed with zero client exceptions
and zero WebSocket closes during measurement; every client observed world seed 25.

Comparison baseline: 3 October at 13:38:08 BST. Both captures used the identical
runner hash, Intel Core Ultra X7 358H host with 16 logical CPUs, Chrome
153.0.8010.12, 320 × 200 viewport, 15-second warmup, 60-second measurement and
120-second cooldowns between player counts. No deployment or production restart
was performed during this check.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00–30.02      | 38.1                  | 46.4               | 9.1–39.7              |
| 8       | 30.00            | 48.0                  | 79.9               | 10.0–101.3            |
| 16      | 29.98–30.00      | 117.5                 | 255.2              | 12.2–124.2            |
| 32      | 30.05–30.08      | 291.8                 | 1070.4             | 36.0–105.1            |

Observed tick cadence remained approximately 30 Hz throughout. Worst-workload
input acknowledgement p95 changed from 63.4 to 46.4 ms at 4 players, 77.2 to
79.9 ms at 8, 207.1 to 255.2 ms at 16, and 1142.8 to 1070.4 ms at 32. The
16-player increase came from the module workload; the other three activities
were close to baseline. Worst snapshot-gap p95 rose about 12% at 16 players,
but fell about 10% at 32.

Median client FPS by activity, shown as **baseline → persistence**:

| Players | Convoy      | Spread      | Contact     | Module      |
| ------- | ----------- | ----------- | ----------- | ----------- |
| 4       | 60.0 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 |
| 8       | 59.9 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 | 59.7 → 56.9 |
| 16      | 40.1 → 40.8 | 59.3 → 59.9 | 35.7 → 28.2 | 28.9 → 23.9 |
| 32      | 11.8 → 11.3 | 26.1 → 23.8 | 6.0 → 7.0   | 5.8 → 6.4   |

The material rendering drops were 21% for 16-player contact and 17% for
16-player modules. Both captures saturated the local host at roughly 99% CPU
in these cases and all 32-player cases. Persistent world contents also change
between activities and runs: contact clients at 16 players observed a median
31 entities versus 25 previously. This is a comparison of deployed behavior,
not an isolated measurement of SQLite overhead, and one run cannot establish
whether those FPS changes are repeatable. No builds or other browser captures
competed with measurements; local recovery tests ran during the 4-to-8-player
cooldown.

Functional verification also passed:

- Existing SQLite store and session persistence tests, covering recovery,
  backups, atomic cargo transfers, checkpoints and module state.
- Existing executable/WebSocket integration test covering reconnect, graceful
  restart and abrupt process kill.
- A separate live disconnect/reconnect retained private identity, player ID,
  ship ID, credits and paint unlocks; `/healthz` returned HTTP 200 afterward.
- Fly health checks passed before, during and after the suite. Production logs
  showed no new server restart, SQLite failure, backup failure or panic during
  the benchmark window.

Raw capture: ignored `benchmarking/local/2026-10-05T12-48-17.625Z.json.gz`.
Final deployment status and server logs are retained locally alongside it as
`persistence-live-2026-10-05-deployment.json` and
`persistence-live-2026-10-05-server.log`.

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

## 6 October 2026 at 18:18:42 BST

Run against deployed revision `7038ffd` (Fly release 46) and entry asset
`index-eRY8z5aw.js`, on the two-vCPU, 512 MiB London Machine with persistent
world seed 25. The runner hash, host, Chrome 153.0.8010.12, 320 × 200 viewport,
15-second warmup, 60-second measurement and 120-second cooldowns between player
counts match the 5 October capture. No builds or other benchmark captures ran
alongside this suite.

**Failed validation: only 15 of 16 cases completed.** The 32-player module case
failed during startup with `All players must connect and receive their ships`;
it has no measured result. The 32-player row below covers only convoy, spread
and contact, so its ranges and worst-workload delays are not a full-suite
comparison with previous runs.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 38.5                  | 61.3               | 9.0–33.1              |
| 8       | 30.00            | 40.9                  | 59.7               | 10.2–65.0             |
| 16      | 29.98–30.00      | 116.5                 | 221.7              | 13.2–169.8            |
| 32      | 30.01–30.11      | 387.6                 | 1128.7             | 35.1–67.8             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

The completed cases maintained approximately 30 Hz observed tick cadence and
recorded zero WebSocket closes during measurement. However, the 16-player module
case recorded **345 client exceptions across 10 clients**, all reading `x` from
an undefined value. Stacks include `Y.fc`, the `Ai` setter and player update
paths in the deployed entry asset. The other 14 measured cases recorded no
exceptions. The 5 October capture recorded none in all 16 cases, so this run
does not validate an error-free deployment.

Production health passed before the suite and during each player-count
cooldown. Fly recorded a health-check failure at **18:47:38 BST**, during
startup of the final 32-player module case. Subsequent public `/healthz` requests
timed out after 10 seconds, including after the runner stopped Chrome. The
Machine remained started with the same instance and release, but its health
check was critical. Captured logs show no new server restart, panic or storage
failure during the benchmark window. The cause of the unresponsiveness is
unconfirmed; this is not evidence that server performance remains good across
all 32-player workloads. No deployment or production restart was performed.

For the measured 32-player workloads, median client FPS changed from 11.3 to
9.5 for convoy, 23.8 to 23.9 for spread and 7.0 to 5.7 for contact versus
5 October. All three saturated the local host at over 99% CPU. Their aggregate
snapshot-gap p95 was 387.6 ms and input acknowledgement p95 was 1128.7 ms;
the previous full-suite values were 291.8 ms and 1070.4 ms. Missing modules,
client exceptions and changing persistent world contents limit comparisons.

Raw capture: ignored `benchmarking/local/2026-10-06T17-18-42.946Z.json.gz`.
Runner output, before/after deployment status and production logs are retained
alongside it as `live-2026-10-06-run.log`, `live-2026-10-06-status-{before,after}.json`
and `live-2026-10-06-server-{before,during,after}.log`.

### Follow-up investigation, GC comparison and local fixes

Fly metrics support memory exhaustion followed by disk-cache thrashing as the
cause of the stall. Available RAM fell below 13 MiB during 32-player contact,
then to 2.3 MiB at 18:47:30 BST and a minimum 1.5 MiB before recovery. Cached
file memory fell from roughly 58 MiB to 8 MiB. Around 18:50–18:52 BST, about
87% of combined CPU time was I/O wait; `vda` and `vdb` were continuously busy
reading approximately 16 MiB/s each, while writes on `vdc` nearly stopped.
CPU throttling remained zero and CPU credits remained positive. This is an
inference from machine metrics, not a production heap or page-fault trace.

The preceding 5 October suite had already approached the machine's limit:
available RAM reached 48.9 MiB, although it did not exhibit that I/O stall.
Both deployments used `GOGC=800`. The persistent world also keeps sleeping
entities and disconnected player records in memory; the benchmark creates up
to 240 new profiles per suite. A separate SQLite-backed churn diagnostic with
480 joined/disconnected profiles raised collected heap from 7.1 to 20.6 MiB
on `5d3500c`, and from 7.2 to 21.3 MiB on the final code. That retention exists
in both revisions. With `GOGC=800`, each additional MiB of live data permits
roughly nine MiB of heap target, including its allocation allowance; see the
[Go GC guide's target formula](https://go.dev/doc/gc-guide#GOGC).
Accumulated profiles, world objects and collision caches therefore amplify
memory use even without a large new leak.

The first fix only imposed `GOMEMLIMIT=384MiB`. That setting did reduce peak
RSS, but it left the aggressive GC policy in place. It has now been removed
and replaced with `GOGC=200` in `fly.toml`, after comparing 100, 200, 400 and
800, with and without the memory limit.

These local sessions use seed 25, 32-player modules, 120 warmup and 6,000
measured ticks, Go 1.27.1, `GOEXPERIMENT=simd`, `GOMAXPROCS=2`, and affinity
0/1. Executables were compiled with `go test -c`, without production main
package PGO. Cases ran sequentially, with no builds or tests competing.
Repeated comparisons alternated order; table values are medians where there
are three runs. The allocation edits were measured separately on `7038ffd`.

| Local code / setting                       | Runs | Peak RSS (MiB) | CPU ms/tick | Tick elapsed p95 (ms) | Allocated KiB/tick |
| ------------------------------------------ | ---- | -------------- | ----------- | --------------------- | ------------------ |
| `7038ffd`, `GOGC=800`, no limit            | 1    | 422.5          | 3.191       | 6.17                  | 429.3              |
| `7038ffd`, `GOGC=100`, no limit            | 1    | 114.2          | 3.225       | 5.85                  | 429.3              |
| `7038ffd`, `GOGC=200`, no limit            | 3    | 160.7          | 3.146       | 5.87                  | 429.3              |
| `7038ffd`, `GOGC=400`, no limit            | 1    | 249.1          | 3.137       | 5.93                  | 429.3              |
| `7038ffd`, `GOGC=800`, `GOMEMLIMIT=384MiB` | 3    | 366.2          | 3.175       | 6.10                  | 429.3              |
| Allocation edits, `GOGC=200`, no limit     | 3    | 155.3          | 3.058       | 5.76                  | 279.3              |

All GC settings, and all nine repeated captures, produced identical final ship
states, entity counts, events, contacts and packet counts/bytes. Collected heap
remained about 48 MiB across settings: the large RSS differences are allocation
allowance and runtime memory, rather than differences in live gameplay data.
`GOGC=200` gives considerably more memory headroom than the limit-only fix with
similar CPU cost; 100 collects roughly twice as often, while 400 retains less
headroom. The isolated allocation edits reduce allocated bytes by 35%,
allocations from 5,385 to 3,990 per tick, and median CPU by 2.8% in these captures.

Heap profiles located the major temporary allocations in collision motion
sweeps. `SolveWorldTOI` allocated two escaping sweep copies per query: 31% of
allocated bytes at 6,000 ticks and 46% in the longer capture. The solver now
reuses two scratch sweeps, copied fully from each body before every query.
The new `fireWeapons` path also built an allocated module list on every ship
update, including ships without weapons. It now uses a stack buffer with the
same append behavior, preserving larger inventories. Profiles also show
retained replication records, collision contacts/constraints and generated
region data in both revisions; SQLite was not the dominant allocation source
in the separate persistence capture.

Longer checks use the same setup with 12,000 measured ticks. Each row is one
capture, including the current revision without the new fixes:

| Local code / setting                  | Peak RSS (MiB) | Collected heap (MiB) | CPU ms/tick | Tick elapsed p95 (ms) | Allocated KiB/tick |
| ------------------------------------- | -------------- | -------------------- | ----------- | --------------------- | ------------------ |
| `5d3500c`, `GOGC=800`, no limit       | 678.8          | 72.6                 | 6.09        | 12.12                 | 503.0              |
| `7038ffd`, `GOGC=800`, no limit       | 713.7          | 78.1                 | 7.01        | 13.31                 | 558.6              |
| `7038ffd`, `GOGC=200`, no limit       | 256.8          | 78.1                 | 6.62        | 12.56                 | 558.6              |
| All final fixes, `GOGC=200`, no limit | 249.1          | 78.2                 | 6.73        | 13.16                 | 291.8              |

The earlier revision also exceeds 512 MiB. Current collected heap is 7.6%
higher and allocated bytes per tick 11.1% higher; these are not isolated leak
measurements, because ship specs and resulting contacts/entities changed.
The final fixes halve allocation in this longer scenario while preserving
current-revision states, contacts, events and packet counts/bytes. Its single
long-run CPU result is slightly higher than lower-GOGC alone, so a general
CPU improvement is not established. Its largest elapsed tick was 34.2 ms.
After disconnect and region unloading, active entities reached zero and
collected heap fell to 73.3 MiB, with 4,465 sleeping entities still retained.
That is existing world/collision-cache retention, not memory that changing
GC frequency can remove.

A separate final-code capture enabled real SQLite writes and advanced the
checkpoint clock through 6,000 measured ticks, waiting for queue capacity
when the accelerated simulation outpaced storage. Peak RSS was 154.0 MiB,
collected heap 43.7 MiB and CPU 2.94 ms/tick; after disconnect, collected heap
was 40.7 MiB with zero active and 2,606 sleeping entities. It uses fake sockets
and accelerated time, so it does not reproduce production filesystem latency
or the full live suite. Separate final-code convoy/spread/contact/module
captures at 32 players and 1,800 measured ticks cost 0.29, 0.59, 0.18 and
1.35 CPU ms/tick respectively, with peak RSS below 80 MiB.

The mount-order and weapon-rendering fixes remain because regression tests
reproduce their failures. The client exception occurs when prediction and
authority lost different mounting hull segments: repair appended hulls after
survivors, changing serialized mount indexes. Both implementations restore
spec order; redundant scans and intermediate segment-array writes from the
first fix have been removed. Weapon wreckage now retains an empty stroke and
default fill, including through Gob persistence, which otherwise drops empty
slices and shade zero. The same round-trip test covers cargo hatches.

All 33 Node test files and all Go packages passed, including collision solver,
production rendering, prediction, session parity, WebSocket integration and
persistence restart tests. Lint and before/after production builds passed.
The client entry shrank 39 bytes from the first fix (128,309 → 128,270 bytes),
the server grew 224 bytes (18,221,816 → 18,222,040), and docked/sound chunks
remain 5,126/1,676 bytes. Formatting checks pass for changed files; the full
checks still report committed formatting issues in three ship specs and two
unchanged Go test files.

Raw metric ranges, captures and heap profiles are retained in ignored
`benchmarking/local/memory-2026-10-06-*`, with the diagnostic patch, churn fixture
and `unicorn-memory-{screen,compare,long,persistence}.py` orchestration scripts.
The preceding evidence remains in `fixes-2026-10-06-*`.
The fixes are in the working tree and have not been deployed or live-rebenchmarked.

### Repeated CPU budget verification

The final fixes with `GOGC=200` were compared with `7038ffd` at `GOGC=800`,
both without `GOMEMLIMIT`. Unlike the initial diagnostic captures above,
both executables use the production `src/server/default.pgo` profile with
`GOEXPERIMENT=simd`. The other settings remain Go 1.27.1, seed 25, 32 players,
120 warmup ticks, `GOMAXPROCS=2` and CPU affinity 0/1. Captures ran sequentially,
alternating before/after order, without concurrent builds or tests. Convoy,
spread and contact use 6,000 measured ticks; modules use 12,000.

CPU is process user plus system time per measured tick, including automatic
GC. The table reports medians across 23 pairs / 46 captures; CPU change is
the ratio of the two medians. Peak RSS is also the median of each capture's
process high-water mark.

| 32-player workload | Pairs | Before CPU ms/tick | Final CPU ms/tick | CPU change | Before peak RSS (MiB) | Final peak RSS (MiB) |
| ------------------ | ----- | ------------------ | ----------------- | ---------- | --------------------- | -------------------- |
| Convoy             | 10    | 0.3894             | 0.4000            | +2.7%      | 244.4                 | 110.2                |
| Spread             | 5     | 0.6943             | 0.6903            | -0.6%      | 303.4                 | 127.0                |
| Contact            | 5     | 0.1838             | 0.1802            | -2.0%      | 119.4                 | 48.1                 |
| Modules            | 3     | 6.9024             | 6.5247            | -5.5%      | 713.1                 | 250.4                |

The largest median increase is convoy's 2.7%, within the requested 3% ceiling
but above a 2% target. Its paired changes range from +0.2% to +4.0%, with a
mean of +2.3%; individual captures do not all stay below 3%. The other three
workloads use less CPU. Module peak RSS ranges from 244.2 to 250.6 MiB,
consistent with the earlier 249.1 MiB capture. Its median elapsed tick p95
falls from 13.36 to 12.53 ms, and its largest elapsed tick is 27.48 ms.

All pairs passed the strict outcome comparison: final ship states, entity
counts, events, contacts and packet counts/bytes matched, with zero measured
motion differences. These sessions use fake sockets without SQLite writes;
they verify simulation CPU and allocation costs locally, rather than the full
production server's network and storage load. The fixes remain undeployed.

Raw captures are retained in ignored
`benchmarking/local/cpu-budget-2026-10-06-{standard,long,convoy-repeat}.json`.
The accompanying `cpu-budget-2026-10-06-metadata.json` records compiler flags,
the production PGO profile hash and both executable hashes.
