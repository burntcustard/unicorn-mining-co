# Deferred and Temporary-Object Persistence Investigation (October 27–28, 2026)

This follows the [release 111 persistence investigation](2026-10-27-server-persistence.md).
The user authorized a few minutes of crash rollback and requested testing
temporary-object filtering before full local/live validation. Client rendering
and graphics defaults remain outside this phase.

## Why one-second batching had limited impact

SQLite encoding and commits already run asynchronously. Release 111 coalesces
ordinary world changes, but player gameplay transactions can still force a
batch every simulation update and hold snapshots until its commit. Increasing
only the background timer leaves that path intact.

A fresh local 32-miner profile attributed 7.87% of sampled Go CPU to the
database writer, compared with 26.97% in replication encoding and 21.91% in
collision stepping. The transient-only profile attributed 5.14% to the writer,
27.43% to encoding, and 24.00% to collision stepping. Both standard mining
workloads passed workload/client/headroom and strict cadence checks. These are
short sampled diagnostic shares, not controlled whole-game speedup measurements;
the profiles themselves add work and target histories differ.

Both diagnostic servers had no explicit Go memory limit. They are not
qualifications against the live 300 MiB budget; the controlled storage fixtures
and final budget-matched matrix use that budget explicitly.

## Separate candidates and controlled measurements

The storage fixtures use real SQLite, two Go processors, `GOMEMLIMIT=300MiB`,
three samples, and 900 updates at a simulated 30 Hz. They include final flush
and commit completion. CPU is process user-plus-system time from `getrusage`,
not elapsed time. Timing-only and combined versions use compiler overlays so
the same workload can run against each policy without changing the default
server benchmark suite.

| Fixture / CPU per simulated update                       | Release 111 | Timing only | Filtering only |    Combined |
| -------------------------------------------------------- | ----------: | ----------: | -------------: | ----------: |
| 32 repeatedly changed world items                        |    76.34 µs |     3.00 µs |              — |     3.22 µs |
| Same items plus gameplay update                          | 2,299.33 µs |     3.30 µs |              — |     3.32 µs |
| Immediate-account control                                | 2,260.71 µs | 2,304.26 µs |              — | 2,311.18 µs |
| Eight projectile/debris pairs created/removed per update |   101.03 µs |   101.95 µs |       11.69 µs |    11.41 µs |

The combined repeated-gameplay fixture submits one batch per 900 updates,
versus one per update before. Its allocation falls from about 539 KB to 598
bytes per update. This measures coalescing repeated changes to the same items;
it does not model every real mining event or establish 99.9% lower server CPU.
The immediate-account control still submits one batch per update; its small
CPU difference is not a demonstrated performance improvement.

The transient fixture submits **zero batches** with filtering. Timing alone
leaves unique runtime deletions accumulating and activates the early-save
threshold, increasing batches from 0.0333 to 0.0633 per update without reducing
CPU. This is why the two policies are being combined rather than relying on
longer timers alone. The fixture explicitly includes projectiles without a
player owner; many player-owned projectiles already avoided the old world-save
path, so its result must not be presented as a measured 89% weapon-game CPU gain.

## Combined source policy

- Ordinary player/gameplay and world records coalesce together. Their live
  snapshots do not await disk. New accounts, initial naming, and moderation keep
  immediate commit requests and their snapshot barriers. Automatic owner-role
  assignment also retains its immediate marker.
- Background capture becomes eligible at 30 seconds, prefers global ticks using
  less than half the normal step budget, and has a 60-second fallback deadline.
  A pending set of 256 world records triggers earlier eligibility. This limits
  accumulation without pretending it is a strict size/time bound.
- A movement/damage checkpoint starts once a minute. Its global eight-entity
  and one-player copy budget remains spread across ticks. Encoding and SQL stay
  on the existing asynchronous worker; mutable live objects are never read there.
- Projectiles and positive-`Decay` world objects are omitted from changes,
  checkpoints, unloads, and shutdown captures. They keep their live simulation
  behavior. Permanent items, ships, stations, asteroids, players, and cargo stay
  saved. Damage caused by temporary objects is not ignored.
- Never-saved runtime deletions cancel their pending creation instead of
  generating SQL work. Already-submitted records remain tracked until their
  later deletion is queued, even before the first write finishes. Generated
  deletions retain tombstones; an old permanent object becoming temporary cannot
  resurrect. Old temporary rows are discarded on restore and removed in a
  queued transaction. Rollout does not require changing the schema or resetting
  the live world.
- Graceful shutdown forces the final permanent state. Ordinary gameplay can
  roll back after a crash, as authorized; related player/world records remain
  atomic within every submitted transaction.

Simulation timing, network snapshot cadence, world generation, SQLite WAL/FULL
durability, schema version 7, and server sizing are unchanged. This scheduler
uses spare tick time; it is not a claim that the host CPU is idle or that an
asynchronous commit consumes no CPU.

## Correctness and rollout status

The transient regressions failed on release 111 behavior and passed with
filtering. Coverage includes permanent state, checkpoints/unloads/shutdown,
temporary-object restart omission, procedural tombstones, old temporary rows,
an object becoming temporary after saving, and removal while its first write
is still uncommitted. Scheduling tests cover quiet ticks, busy deadlines, early
saves, continued snapshots, atomic collection saves, and coherent rollback of
an unsaved collection after a simulated crash. Existing account-barrier,
moderation, trade, collection, reconnect, and restart coverage passes.

The combined production build, all 122 Node tests and all Go packages, lint, and
Go formatting passed. The fresh-world **unchanged default local 20-case matrix
passed all twenty cases and all twenty strict cadence checks**. Its completed
validation is recorded below. Live deployment/validation follows this local
qualification and the required ten-minute post-restart wait. The live world
remains preserved.

The first combined local matrix was deliberately interrupted between cases
after the four-player block to correct the owner-bootstrap immediate marker.
All five completed cases passed strict cadence and workload validation, and
cleanup had no errors. Its `complete=false` and SIGINT are retained. A new
regression failed before the correction and passed afterward; the full local
qualification restarts from a fresh world on the corrected source.

The next local attempt was stopped after the runtime audit showed that the
normal watcher had no `GOMEMLIMIT`; the `--cores 2` flag only controls affinity.
Its completed cases and clean cleanup are retained separately, without claiming
a live-budget match. The replacement watcher explicitly uses
`GOMEMLIMIT=300MiB`. A local runner guard verifies the actual Go process
environment and default `GOGC=100` before starting the unchanged matrix.
`budget-matched-local-matrix.json.gz` is the final qualification capture;
`final-local-matrix.json.gz` is the earlier memory-unmatched partial capture.

A further live-lifetime regression caught an important distinction: a generated
temporary object's restart tombstone must not remove it from the live region
before its normal expiry. The test failed before separating those operations
and passed afterward. The small budget-matched partial run was retained as
`pre-lifetime-fix-local-matrix.json.gz`; full qualification restarts on the
corrected source. Final full tests, including all 122 Node tests and Go packages,
also passed with `GOMAXPROCS=2` and `GOMEMLIMIT=300MiB`.

The following attempt was interrupted by concurrent weapon-spec edits that
restarted the normal watcher. Thirteen completed cases passed workload and
strict cadence validation before those restarts; later affected cases and the
failed affinity cleanup are retained in `spec-edit-interrupted-*`. It is not a
full qualification. The user authorized including those spec edits. A fixed
worktree at `/tmp/unicorn-cpu-20261027` now contains the corrected candidate,
laser damage 0.2, and the plasma/example-weapon constant inlining. Unrelated
ongoing minimap and root README edits remain in the development checkout. The
fixed copy passed the production build, all 122 Node tests and Go packages under
the two-processor/300 MiB budget, lint, and Go formatting before a new fresh-world
matrix began at 22:58:51 UTC. The weapon workload equips lasers, so the approved
spec change is part of this candidate's recorded environment. The suite itself
is unchanged.

The new `server-load` capture counters record the number and owner-thread time
of accepted save batches, including a maximum, alongside existing tick and GC
timings. They will check whether fewer writes create larger capture spikes.

Client resource bytes are unchanged in this phase. The stripped production
server is 13,762,720 bytes, compared with 13,754,528 before, an 8,192-byte
increase. Its final production artifact is archived and hashed before the
normal watcher builds the local benchmark executable.

## Release 112 rollout and cooldown

Release **112** started on the existing Machine at **October 28, 00:02:55.598
UTC**. Deployment used the archived, verified stripped production executable
and built client from the fixed source. The existing world volume, world seed,
database path, two shared vCPUs, 512 MiB VM memory, 300 MiB Go budget, and default
GOGC remain unchanged. Health checks pass. No live world reset was performed.
The earliest permitted live benchmark start is **00:12:55.598 UTC**; the runner
checks that deadline before starting the unchanged suite. The live runner
started at **00:13:20.044 UTC**, 10.41 minutes after the Machine start. The
pre-run quota sample showed 161.59 CPU-seconds of credit and zero throttling.
The first unchanged full live attempt completed with eighteen valid cases
and two preparation failures; it is not an all-valid qualification.

## First unchanged release 112 live attempt

The default suite ran from **00:13:20.044 to 01:31:05.356 UTC on October 28**,
77.76 minutes including preparation and cleanup. It traversed all twenty cases,
with the original 15-second warmup, 30-second measurement, 600-second setup
budget, and one repetition. **Eighteen cases measured and passed workload,
client-consumption, and generator-headroom checks. Eight of those eighteen
passed strict cadence.** No measured input ACKs were missing. Cleanup was clean;
the CLI exited with status 1 and the strict all-valid auditor correctly rejects
this capture. The attempt auditor explicitly records `qualified=false`.

| Players | Convoy | Spread | Contact |       Mining |      Weapons |
| ------: | -----: | -----: | ------: | -----------: | -----------: |
|       4 |  1.30% |  1.87% |   1.80% |        3.30% |        1.83% |
|       8 |  1.43% |  2.33% |   2.60% |        4.90% |        2.57% |
|      16 |  2.33% |  3.37% |   3.73% |        9.33% |        3.60% |
|      32 |  3.97% |  5.77% |   8.66% | setup failed | setup failed |

These are **Fly whole-machine CPU** readings from the observer's available raw
counter interval inside each 30-second client measurement; that CPU interval can
be shorter than the full client window. They are not local Go-process CPU.
There is **no new live 32-miner CPU measurement**, and the failed preparation
must not be ranked as an improvement.

The Machine, image, runtime settings, existing world volume, and passing health
were unchanged. Across **314 enclosing quota samples**, credit began at
**168.35 CPU-seconds**, never fell below that, and ended at **332.23 CPU-seconds**.
The throttle counter increased by **zero** without a counter reset; the baseline
remained 0.125 CPU-equivalents. The enclosing 78.25-minute whole-machine CPU
counter interval averaged **4.50%**, with 2.46 seconds of steal time. It encloses
preparation, failed setup, warmup, measured work, and cleanup. This establishes
no throttling during the actual attempt, while retaining its missing cases.

The 32-miner setup reserved **29/32** separate areas before exhausting the
unchanged budget. Its final error was a survey ship that had not settled before
reserving its approach; the loadout was intact and no protocol error was
reported. The 32-weapon case passed initial staging, then lost readiness after
warmup before measurement. Authoritative diagnostics show ships 25 and 26
(indices) occupying overlapping hull space, moving rapidly, and blocking one
another's firing lanes. This is a staging failure, not a validated weapon CPU
sample. No timeout, readiness check, physics rule, or benchmark workload was
changed to force either case to pass.

The world was preserved for these follow-up checks. The user subsequently
authorized resets for fair comparisons; the next investigation records the
first authorized reset in the
[October 28 SQLite CPU report](2026-10-28-server-sqlite-cpu.md).

Evidence: `live-matrix.json.gz`, `live-window.json`, `live-attempt-audit.json`,
`live-strict-audit.log`, `quota-complete-live.json`, and the before/after Machine
records. The strict all-valid `audit-live.ts` remains intact.

## Preserved-world targeted checks and second full attempt

Both previously missing standard cases subsequently passed by themselves on the
same release and preserved world, with the default 600-second setup budget,
15-second warmup, and 30-second measurement. Neither required a restart or reset.

| 32-player diagnostic | Machine CPU |  Gap p95 | Maximum gap |        ACK p95 |    Maximum ACK |
| -------------------- | ----------: | -------: | ----------: | -------------: | -------------: |
| Mining               |      15.43% | 37.21 ms |    73.42 ms |       50.82 ms |       91.54 ms |
| Weapons              |       7.06% | 41.46 ms |    53.56 ms | no input edges | no input edges |

Both passed workload, client-consumption, generator-headroom, and strict cadence
checks, with no missing ACKs or cleanup errors. Mining reached physical readiness
in 552.4 seconds. These are targeted diagnostic validations, **not** a completed
full suite or a controlled live before/after CPU comparison. Raw files are
`live32-mining-diagnostic*` and `live32-weapons-diagnostic*`.

A second **unchanged default full suite** started at **02:00:12.430 UTC** using
`live-retry-matrix.json.gz`. Machine/image/configuration remain unchanged and the
world is preserved. The pre-retry sample showed 367.71 CPU-seconds of credit
and a zero throttle counter. Four-player mining exhausted preparation at 3/4
ready areas. The retry was interrupted cleanly between cases at 02:16:16.123
after five attempted cases, four valid measurements, and no cleanup failures.
It is not a completed qualification. The enclosing quota audit found a minimum
369.99 CPU-seconds of balance, ending at 446.28, and zero throttle increase.
Evidence is `live-retry-partial-audit.json`; the strict full auditor rejects
the incomplete run. The failed first attempt remains separate.

## Live cadence findings

The first eight live cases all passed workload, client-consumption, and
headroom validation, but only the first three passed strict cadence. Four-player
mining recorded a shared arrival gap up to **172.83 ms**, worst-client gap p95
34.57 ms, input-ACK p95 43.89 ms, and ACK maximum **161.91 ms**. No input ACKs
were missing; every client's maximum measured server tick-ID gap was one. The worker
used 3.71% of one local core, with a 3.42 ms maximum event-loop delay and a
34.77 ms maximum input-timer gap.

The enclosing live server interval ending 00:26:34 reported a 14.30 ms maximum
tick, 1.54 ms maximum runtime save capture, and zero overruns/catch-ups. Quota
credit remained positive and the throttle counter remained zero; a sample after
that mining case showed 224.55 CPU-seconds. These observations do not establish
the exact cause of the 173 ms arrival gap, and do not demonstrate that clients
cannot feel it. Four-player weapons also had a shared 168.51 ms arrival gap;
eight-player convoy, spread, and contact also failed strict cadence. There is
no all-smooth live claim.

The protocol-only clients isolate these delivery measurements from browser
rendering. Passive kernel TCP sampling began at 00:29:46 UTC using `ss` once per
second against the game's IPv4 address. It adds no game requests. Early samples
showed no client-side retransmissions and RTT estimates below 38 ms; these are
sampled outgoing counters and cannot rule out incoming TCP delays. Header
capture was unavailable under the existing OS permissions. The raw evidence is
`live-tcp-info.jsonl`; the observer stopped at 02:17:49 UTC. Its full sampled
window showed a maximum outgoing smoothed RTT of 48.08 ms and 20 client-side
retransmission counters across 20 ports. These observations still cannot locate
the cause of the incoming arrival gaps.

## Completed fixed-source local qualification

The full default matrix ran from **October 27 at 22:58:51 UTC to October 28 at
00:01:49 UTC**, about 63 minutes including preparation and cleanup. It used the
normal watcher/proxy, two-core affinity, `GOMEMLIMIT=300MiB`, default `GOGC=100`,
and one fresh-world reset before the matrix. All **20/20** cases passed workload,
client-consumption, and generator-headroom validation; **20/20** passed strict
cadence. No input acknowledgments were missing and cleanup was clean. Source
and built-client checksums remained unchanged throughout. The root development
services were restored afterward.

| 32-player workload | Go CPU, one core | Snapshot-gap p95 | Maximum gap |  Input-ACK p95 |    Maximum ACK |
| ------------------ | ---------------: | ---------------: | ----------: | -------------: | -------------: |
| Convoy             |            2.47% |         34.23 ms |    37.73 ms |       35.88 ms |       35.88 ms |
| Spread             |            3.42% |         34.20 ms |    35.35 ms |       34.21 ms |       35.29 ms |
| Contact            |            4.83% |         34.27 ms |    37.35 ms |       35.47 ms |       38.23 ms |
| Mining             |            7.58% |         34.28 ms |    36.92 ms |       34.34 ms |       37.94 ms |
| Weapons            |            4.27% |         34.15 ms |    35.21 ms | no input edges | no input edges |

P95 columns show the worst client's p95. These are protocol delivery/ACK
measurements, not rendered-browser frames or input-to-draw latency. The maximum
snapshot gap across the whole local suite was 37.73 ms; the largest ACK was
38.23 ms. Weapon windows contain no new input edges, so zero samples do not
mean zero input latency.

The six reported ten-minute intervals recorded an 8.17 ms maximum tick, a
3.04 ms maximum accepted save capture, and zero overruns/catch-ups. Heap was at
most 62.9 MiB **at interval boundaries**, not necessarily at its peak. The final
roughly three minutes are outside those completed intervals. These logs include
preparation and several workloads and cannot assign every maximum to a
particular measured case.

The 32-miner Go CPU sample was 7.58%, versus 7.64% in the previous corrected
local 32-player matrix. This does **not** establish a substantial whole-game
CPU reduction; target/world histories differ and the small difference may be
variation. Controlled storage fixtures demonstrate the save-path reduction;
replication and collision work remain larger sampled costs. The goal of the
live qualification remains the unchanged complete suite with positive CPU
balance and no throttling, while checking delivery separately.

Evidence: `budget-matched-local-matrix.json.gz`, `local-window.json`,
`local-audit.json`, `snapshot-server.log`, `snapshot-local-load-summary.json`,
and the source/client checksum manifests in the raw directory.

Raw evidence is in `benchmarking/_local/loose-persistence-2026-10-27/`, including
the SQLite/transient sample files, compiler overlays, `micro-summary.json`,
baseline and filtering profiles, regression logs, build/test logs, and the
combined local matrix. The initial baseline connection attempt omitted Vite and
failed before gameplay; it is retained separately as `before-connection-failure`
and excluded from performance evidence. Both successful diagnostic sessions
started from fresh local worlds with normal services; the combined matrix
started after its own recorded reset.
