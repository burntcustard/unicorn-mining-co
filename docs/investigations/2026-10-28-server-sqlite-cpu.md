# SQLite world-saving CPU investigation, October 28, 2026

Release 113 completed the unchanged default live suite: **20/20** cases passed
workload, client-consumption, and generator-headroom validation, with zero
missing input acknowledgments and **zero throttling**. Sampled CPU balance
stayed above **183.82 CPU-seconds** and ended at **424.48**. The enclosing
whole-machine CPU average was **2.89%**, including the OS. Machine sizing and
memory/GC settings were unchanged. Completed server intervals cover the entire
suite and report zero tick overruns or catch-ups, with a 21.81 ms maximum tick
against the normal 33.33 ms budget.

Saving is substantially cheaper in controlled fixtures, but the short matched
16-player whole-game CPU comparison was effectively unchanged. The fresh live
world and different targets prevent attributing the lower live scores entirely
to code changes. Strict cadence passed **15/20** cases; live delivery outliers
remain, so this is not an all-smooth claim. The 32-miner case passed cadence,
with a 48.18 ms maximum snapshot gap and 53.71 ms maximum input ACK.

Raw evidence is in `benchmarking/_local/sqlite-cpu-2026-10-28/`.

The user authorized resetting the live world for fair comparisons while nobody
is playing for the next eight hours. A release-112 baseline reset completed at
02:53:13.769 UTC; its archived database is
`/data/world.sqlite.reset-1579423774`. No live benchmark ran after that reset;
baseline/candidate CPU comparisons were performed locally.

Release 113 booted at 03:40:42.458 UTC on the same shared two-vCPU/512 MiB
Machine and volume, with unchanged memory/GC settings. Its image digest is
`sha256:85f28be20c161420e3cdb2675a0be8e4a67364a6f7c3bc8317be1265b6b6dbf6`.
The authorized candidate reset completed at 03:41:07 UTC, archiving
`/data/world.sqlite.reset-3071270094`; the Machine stayed running. A conservative
ready marker was recorded at **03:41:59.270 UTC**. The guarded full-suite runner
allows no preparation before **03:51:59.270 UTC**, ten minutes after that marker
and more than ten minutes after boot. The read-only pre-suite storage check
found 652.15 MiB free and retained every backup/reset archive.

The unchanged full default live suite started at **03:52:25.103 UTC**, 10 minutes
25.833 seconds after the ready marker and 11 minutes 42.645 seconds after boot.
The last pre-load balance scrape was 182.61 CPU-seconds and the throttle counter
was zero. It finished at **04:52:03.349 UTC**, 59.64 minutes later, with CLI exit
0 and no cleanup errors. The independent `audit-live-full.ts` passed all
default-matrix, cooldown, runtime, identity, counter-continuity, and quota checks.

An early live cadence outlier remains: eight-player convoy recorded maximum
snapshot arrival gaps of 157–163 ms on three clients; the other five stayed
below 36 ms. Every tick-ID gap was one. The generator's maximum event-loop
delay was 2.80 ms. Sampled input ACKs were at most 45.01 ms, but there were only
seven input events per client, so that does not bound latency at every moment.
The enclosing server interval had a 4.63 ms maximum tick and no overruns or
catch-ups. This argues against a 160 ms simulation stall without establishing
the delayed delivery stage.

Server connection `max_gap_ms=33.3` is derived from tick-ID spacing, not elapsed
socket-write or delivery time. Zero buffer/window stalls means the application
flow-control gates did not skip snapshots; a smaller asynchronous queue or
transport delay remains possible. These protocol results are not browser-frame
measurements and do not establish that the gap cannot be felt. Evidence:
`early-live-cadence.json`, the partial/full capture, and `live-server.log`.

Sixteen-player contact later recorded a 187.62 ms maximum snapshot arrival gap,
37.46 ms worst-client gap p95, and a 226.80 ms maximum sampled input ACK. Four
clients skipped two or three tick states; generator event-loop maxima stayed
below 2.25 ms. Across the entire connection lifetimes, 13 missing snapshots
exactly match 13 receipt-window stalls, with no buffer stalls. This establishes
flow-control suppression as a contributor to missing states, but logs lack the
client IDs and per-stall timestamps needed to bind every omission to the
measured outlier. The initial delivery/receipt delay remains unexplained.
Evidence: `contact16-cadence.json` and connection logs around 04:15:20 UTC.

## Changes

- Reuse the background writer's Gob encoder for world entities. Retain the
  concrete type descriptors once and prepend them to each fresh record buffer.
  Records remain independently decodable and byte-identical to the old format;
  schema 7 and the existing reader are unchanged. The encoder belongs to one
  writer and retains a buffer sized for its largest encoded record.
- Start passive movement/damage checkpoints every three minutes rather than
  every minute. Continue copying at most eight world entities and one player
  per global tick. Ordinary gameplay saves remain eligible after 30 seconds,
  due by 60 seconds, with existing immediate account barriers. No simulation,
  input, or replication timing changes.
- Capture player ship modules directly from their mounts, avoiding temporary
  generic module states and redundant processing of modules inside cargo.
- Keep an ordered active-player roster and an ID lookup for saved profiles.
  Persistent historical profiles no longer need a per-tick roster scan or a
  full scan for each collection/docking progress event. Preserve the previous
  order and disconnected-ship grace period.
- Append world entities directly into checkpoint storage, removing an
  intermediate slice allocation.
- Remove duplicate module ID, health, and segment copies from world entity
  captures. `ModuleStates` already owns them; live shades still need a copy.
- Prepare the entity UPSERT once per transaction and reuse it for the batch,
  rather than asking SQLite to parse it for every row. Runtime deletion SQL,
  transaction ordering, and `synchronous=FULL` remain unchanged.

## Controlled local CPU measurements

All fixtures use `GOMAXPROCS=2`, `GOMEMLIMIT=300MiB`, default `GOGC=100`, and the
normal SIMD build setting, running serially. CPU measurements use process user
plus system CPU time, including asynchronous writer work. Three samples per
variant are retained. These percentages describe persistence work, not total
game-server CPU.

The checkpoint fixture advances 541 simulated seconds per operation, including
nine old one-minute or three proposed three-minute sweeps. It contains moving
items, pristine spinning asteroids, damaged asteroids, stationary items, a
station, and two players. It waits for every accepted batch to commit, avoiding
artificial backlog coalescing under compressed time. Its saved entity fixture
is 254,096 bytes. The immediate-account case is a control for the existing
durability barrier.

| Variant                                      | Checkpoint CPU ns/update | Gameplay-update CPU ns/update | Immediate-account CPU ns/update |
| -------------------------------------------- | -----------------------: | ----------------------------: | ------------------------------: |
| Release-112 baseline                         |                    3,998 |                         4,212 |                           4,949 |
| Encoder reuse only                           |                    2,691 |                         2,749 |                           3,577 |
| Ship capture/history only                    |                    4,074 |                         4,015 |                           4,847 |
| Three-minute checkpoint plus capture/history |                    1,900 |                         1,937 |                           2,672 |
| Combined                                     |                    1,252 |                         1,493 |                           2,174 |

Combined reductions are 69%, 65%, and 56% respectively. Allocations in the
checkpoint-only fixture fall from 1,553 to 313 bytes per simulated update.
Accepted batch counts are unchanged in this fixture; the improvement comes
from capturing/encoding fewer passive records and less work per record.

Larger asteroid encoding confirms the effect is not limited to small records.
For a changing radius-160, 13-point damaged asteroid (about 6.8 KB), median
encoding CPU falls from 42.1 to 17.8 microseconds. A changing radius-300
asteroid with the normal nine points falls from 36.4 to 12.9 microseconds.
Encoded sizes remain unchanged. Ship capture takes about 1.72 rather than
3.21 microseconds for a default ship, and 28.7 rather than 54.3 microseconds
for a cargo-heavy ship. These are isolated capture timings, not whole ticks.

The history fixture keeps 16 active players and adds 0, 2,500, or 10,000 inert
historical profiles. It shares inert geometry to isolate traversal cost and
does not model the memory cost of 10,000 distinct ships. With 10,000 profiles,
median full tick time falls from 148.8 to 104.7 microseconds; with no history,
both variants are about 104 microseconds.

Removing redundant world-module copies reduces ship capture CPU from 3.77 to
3.46 microseconds and allocations from 90 to 73 per operation. A station with
no fitted modules is an unchanged control. The cargo-heavy example removes
49 allocations but changes CPU only slightly.

The prepared-statement experiment was screened with five samples, then checked
with longer ten-operation samples in reversed order. In the confirmation run,
median checkpoint-only CPU falls from 1,255 to 1,069 ns/update (15%),
gameplay-update from 1,385 to 1,182 (15%), and immediate-account from 1,924 to
1,816 (6%). Ranges do not overlap in those three confirmation comparisons.
These numbers are incremental to the combined changes above. The CPU metric
shows a gain that earlier wall-time-only save experiments did not resolve.

## Validation and limits

The integrated encoder and the longer checkpoint interval passed the full Go
server tests. Encoder tests compare exact legacy bytes and independent decode
across entity types, recursive cargo, row orders, zero and nonfinite values,
and a failed encoding followed by retries. A type-graph test rejects future
interface fields, which would invalidate fixed descriptor reuse. Ship capture
tests compare the previous implementation across every catalog ship and verify
snapshot ownership. Roster tests cover restore, reconnect, ordering, expiration,
and stable iteration during lifecycle changes.

The 16-player diagnostic profiles contain only 87 mining and 103 preparation
CPU samples. They do not establish saving as the dominant whole-game cost.
Replication, collision work, and outgoing system calls remain larger sampled
costs. Profiled runs are excluded from performance comparisons.

## Fresh-world 16-player mining screen

The unprofiled baseline and candidate each started after their own local world
reset, using the normal watcher, two-core affinity, 300 MiB memory budget, and
unchanged 600-second preparation, 15-second warmup, and 30-second measurement.
Both passed workload, client-consumption, headroom, and strict cadence checks,
with zero missing input acknowledgments or cleanup failures.

| Measurement                         | Baseline | Candidate |
| ----------------------------------- | -------: | --------: |
| Go process CPU, percent of one core |    3.60% |     3.67% |
| Worst-client snapshot gap p95       | 34.17 ms |  34.20 ms |
| Maximum snapshot gap                | 37.12 ms |  36.48 ms |
| Worst-client input ACK p95          | 33.19 ms |  33.69 ms |
| Maximum input ACK                   | 35.40 ms |  35.57 ms |

This small CPU difference does not demonstrate a whole-game gain or a
regression. Preparation paths and target histories vary even after world
resets. The controlled fixtures establish the save-path CPU reductions; the
protocol screen checks actual mining behavior and delivery. It does not
measure rendered browser frames. Evidence: `local-baseline16.json.gz`,
`local-candidate16.json.gz`, and `local16-comparison.json`.

## Fresh-world 32-player mining screen

The unchanged single 32-miner case passed after a separate local reset, under
the same two-core affinity and 300 MiB memory budget. Go process CPU was 7.26%
of one core. Worst-client snapshot gap p95 was 34.21 ms, maximum gap 36.58 ms;
input ACK p95 was 34.28 ms and maximum 37.22 ms. All workload, consumption,
headroom, and strict cadence checks passed. No ACKs were missing and the maximum
observed server tick-ID gap was one. These are protocol measurements, not
rendered-frame observations.

The ten-minute server log covering preparation reported a 7.90 ms maximum tick,
zero overruns/catch-ups, and a 0.27 ms maximum accepted save capture. That
completed interval ends before the measured mining window; its bounds must not
be attributed to the entire case. Heap was 28.4 MiB at that boundary, not
necessarily at its peak. Evidence: `local-candidate32.json.gz`,
`local32-audit.json`, and `candidate32-server.log`.

This is a targeted local validation, not a new complete local matrix. The
complete live suite below qualifies the deployed candidate. The frozen local services
were stopped after validation and the normal root-checkout Go watcher and Vite
services were restored.

## Completed live qualification

The full default matrix used all five workloads at 4, 8, 16, and 32 players,
with unchanged 600-second preparation, 15-second warmup, and 30-second
measurement. No resets, restarts, or configuration changes occurred during it.
The Machine, instance, image, two shared vCPUs, 512 MiB RAM, volume,
`GOMEMLIMIT=300MiB`, and default `GOGC=100` stayed fixed; health checks passed.

The quota audit encloses preparation through cleanup with 240 samples per
counter from 03:52:22.156 to 04:52:12.155 UTC, checks continuity and absence of
counter resets, and finds zero throttle increase. Balance rises from its
183.82 CPU-second minimum to 424.48. Common whole-machine CPU counters enclose
the suite from 03:52:11.883 to 04:52:11.880, averaging 2.89% over that hour.
Their total includes 129.15 CPU-seconds of user work and 78.98 of system work;
steal time totals 1.43 seconds. Peak mining still exceeds the sustained 6.25%
machine quota, as explicitly allowed; the complete run stays unthrottled.

| 32-player workload | Machine CPU | Worst-client gap p95 | Maximum gap | Worst-client ACK p95 |    Maximum ACK |
| ------------------ | ----------: | -------------------: | ----------: | -------------------: | -------------: |
| Convoy             |       2.70% |             34.91 ms |   108.06 ms |            105.05 ms |      105.05 ms |
| Spread             |       4.60% |             37.54 ms |    59.13 ms |             47.11 ms |       64.41 ms |
| Contact            |       7.30% |             41.27 ms |   185.22 ms |            110.20 ms |      271.44 ms |
| Mining             |       9.83% |             36.02 ms |    48.18 ms |             47.07 ms |       53.71 ms |
| Weapons            |       6.17% |             41.09 ms |   159.17 ms |       no input edges | no input edges |

Each CPU value uses raw counters wholly inside its client measurement; those
counter intervals can be shorter than 30 seconds. Weapons has no new input
edges in the window, so absent ACK samples do not mean zero input latency.
Mining includes 16,408 acknowledged input events across 32 clients and no
skipped tick states. These are protocol timings, not rendered frames or
input-to-draw latency.

Five cases fail strict cadence: eight-player convoy, sixteen-player contact,
and thirty-two-player convoy, contact, and weapons. Their delivery outliers
remain important even though workload/client validity and quota checks pass.
Seven completed server intervals ending 04:01:07 through 05:01:07 cover the
entire suite, including its final weapons window and cleanup. They report a
**21.81 ms maximum tick**, **zero overruns**, and **zero catch-ups**. Included
intervals also contain some idle time before/after the suite, so their maxima
are conservative whole-suite bounds rather than timestamps of particular
client gaps.

Those intervals report 714 accepted save batches, 8,638 entity records, 1,637
player records, 78.48 ms total accepted save capture, and an 8.32 ms maximum
accepted capture. Capture excludes incremental checkpoint copies and the
writer's asynchronous encoding/SQL work; simulation-owner checkpoint work is
still included in tick timings. GC pauses total 51.04 ms across the intervals,
not one long pause. Maximum heap at an interval boundary is 91.3 MiB, not a
peak-heap measurement. The parser found no coverage gaps, conflicting interval
records, or malformed load reports.

Evidence: `live-full.json.gz`, `live-window.json`, `live-audit.json`,
`quota-complete-live.json`, before/after Machine metadata, `live-server.log`,
and `live-load-summary.json`. Prior release-112 failed/partial attempts are
separate evidence and are not combined with this qualification.

## Build artifacts

Builds before and after passed, along with lint and the repository's custom Go
formatter. The final production server grows from 13,762,720 to 13,787,296 bytes
(24,576 bytes). Root and frozen-checkout server binaries are byte-identical;
the candidate SHA-256 is
`bce38dad4117fb20c4f08da58cd0970615e275f23a59b7a58fe60ae73951d186`.
The frozen deployment client matches the release-112 checksum manifest exactly.
Concurrent README and client minimap edits remain in the user's checkout and
are outside this fixed server comparison. The already approved weapon specs
are identical between the baseline and candidate.
