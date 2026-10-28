# Server Persistence Investigation (October 27, 2026)

This continues the [CPU and smoothness investigation](server-cpu-investigation-2026-10-27.md).
The [deferred-save and temporary-object follow-up](server-deferred-persistence-investigation-2026-10-27.md)
tests the user's subsequent relaxed-durability and lifetime-filtering requests.
Its release 112 changes and validation are recorded separately from release 111.
The current priority is server CPU. Backdrop blur remains enabled by default;
the user requested a saved graphics option rather than a change to the default
appearance. Further rendering optimization is outside this phase.

Release 111 deploys the changes below. Two unchanged default live attempts
recorded **zero throttling** with positive credit throughout. Each had 19 valid
cases and a different final weapon failure, so neither is a fully passing
20-case qualification. The second attempt measured all twenty cases. Both live
32-miner measurements and the final local 32-player matrix passed strict
cadence; occasional live delivery gaps in other workloads remain unresolved.

## Findings before changes

The server does not serialize the whole map every simulation update. It already
tracks changed entities and saves sleeping objects when they leave the active
world. A separate checkpoint visits active entities every 30 seconds, copying
at most eight entities and one connected player per call. That checkpoint is
still needed: continuous motion and partial asteroid damage do not all emit
structural change notifications. Removing it would lose valid saved state.

The expensive part is that changed world records and checkpoint slices can
submit separate transactions every tick. Each submission copies world/sector
metadata and the background writer encodes records and commits SQLite with
WAL and `synchronous=FULL`. Existing SQL avoids rewriting equal entity blobs,
but encoding, SQL execution, and transaction work still occur.

An existing local 32-miner CPU profile attributed 12.77% of sampled Go CPU to
the database writer. A fresh 25-second local profile in this phase attributed
9.04%, versus 22.87% in collision stepping. These are sampled cumulative shares,
not percentages of a whole machine; overlapping stacks must not be added.
Persistence is a useful target, but it is not the majority of current server
CPU. The profiled workload passed client, headroom, and strict cadence checks;
its CPU percentage must not be ranked as an unprofiled result.

## Persistence candidate

Ordinary pending world changes now coalesce for one second. Multiple updates
to an entity retain its latest record. A player transaction immediately flushes
all affected pending records, preserving the existing commit barrier and the
atomic relationship between inventory changes and world removals. Shutdown
also flushes deferred data. The queue remains bounded and storage failures and
backpressure retain their gameplay checks.

Checkpoint copying remains spread across ticks. Its immutable captured records
are held for the later background batch, rather than copying a second's worth
of checkpoints in one tick. A newer structural change replaces an older
checkpoint capture. The 30-second checkpoint schedule, simulation step,
snapshot rate, world generation, schema, SQLite durability settings, and VM
sizing are unchanged. Background writes acquire up to one second of intentional
coalescing delay; player transactions do not wait for that timer.

Regression coverage verifies the one-second deadline, retention of the latest
world position, immediate inventory/removal commits, shutdown flushing, and
replacement of an older checkpoint by newer gameplay state. Existing save,
restart, collection, sector, trade, and commit-barrier tests also pass.

### Controlled SQLite comparison

Five samples use the same real SQLite workload with 32 changed world items,
a simulated 30 Hz clock, two Go processors, and a 300 MiB memory budget. The
original implementation is supplied through a compiler overlay, including the
release 110 checkpoint fix. A separate player-transaction control marks each
update critical. Commit completion is awaited; these are elapsed times and
allocation measurements, not a direct process-CPU measurement.

| Workload                                 |       Before |     Candidate | Interpretation                               |
| ---------------------------------------- | -----------: | ------------: | -------------------------------------------- |
| Background, elapsed per simulated update |     5.106 ms |      0.161 ms | 96.84% less elapsed work                     |
| Background, batches per update           |        1.000 |  about 0.0332 | roughly 30 updates per batch                 |
| Background, allocated bytes per update   | about 531 KB | about 17.6 KB | roughly 96.7% lower                          |
| Player transaction, elapsed per update   |     5.240 ms |      5.026 ms | remains immediate; ordinary sample variation |
| Player transaction, batches per update   |        1.000 |         1.000 | no intentional commit delay                  |

This does **not** establish 97% lower total server CPU. Real gameplay has a mix
of critical saves, background changes, checkpoints, physics, and replication.
Full workload measurements are recorded separately below.

## Graphics setting and diagnostic scope

A narrow Chrome trace reproduced a 66.7 ms frame gap with approximately 67 ms
in the draw/swap pipeline; adjacent game callbacks took about 3 and 13 ms.
This identifies presentation backpressure for that occurrence rather than a
66.7 ms JavaScript callback. It does not establish the cause of every older
frame gap.

A same-browser, 25-second on/off/on comparison of HUD backdrop blur used normal
turning controls and hardware-accelerated Canvas on an RTX 5070 Ti. The on
phases had 6 and 3 frame intervals over 33.34 ms, with maxima 50.1 and 41.7 ms;
the off phase had none, a maximum of 25.1 ms, and p99 8.4 ms. Tracing adds work,
so this is diagnostic evidence rather than an unprofiled gameplay score.

Per the user's clarification, backdrop blur is a separate persistent graphics
setting **enabled by default**. It applies immediately to cards and fullscreen
backdrops. Existing graphics-array preferences are preserved. The production
settings-menu check verifies the enabled default, toggling, and saved value;
unit coverage also verifies restoration after reload. The temporary experiment
that disabled blur unconditionally was reverted. Its interrupted combined
benchmark is retained as interrupted data, not a qualified candidate result.

## Benchmark tooling

The live CPU observer obtains a current Fly credential for each metrics read.
Previously a credential obtained before long preparation could be rejected
on the final request, as happened in the prior live diagnostic. A fake-CLI and
metrics regression checks separate credentials for availability and final
reads. CPU-window selection and workload definitions are unchanged.

## Validation and measurements

Production builds, all 122 Node tests and Go package tests, lint, Go formatting,
and the production menu checks passed before the full local matrix. A further
focused checkpoint-order regression also passed. Normal ports and services
are used; the live world is preserved. The complete candidate local matrix
starts with another explicitly recorded fresh-world reset before its first
case, rather than reusing the exploratory profile world.

Raw evidence is in `benchmarking/_local/persistence-2026-10-27/`:

- `before-module32.pprof` and `before-module32-profiled.json.gz`.
- `sqlite-before-bench.txt`, `sqlite-after-bench.txt`, and `before-overlay.json`.
- `browser-trace-v2.json`, `hud-ab.json.gz`, and `hud-ab-analysis.json`.
- `local-full-matrix.json.gz` and `matrix-reset.log`.

The first broad Chrome trace exceeded JavaScript's string-size limit on export;
its partial capture is not used as healthy evidence. The narrowed trace uses
chunked output. Diagnostic capture scripts and traces are archived separately
from the unchanged default benchmark definitions.

### Resource sizes

The saved blur option adds 851 raw bytes across the changed client resources:

| Resource                |   Before | Candidate |
| ----------------------- | -------: | --------: |
| Main CSS                | 10,483 B |  10,587 B |
| Main JavaScript         |  9,570 B |   9,907 B |
| Main HTML               |  8,149 B |   8,206 B |
| Menu screens JavaScript | 14,291 B |  14,644 B |

Other client resource byte sizes are unchanged. The stripped server remains
13,754,528 bytes. These sizes include the default-on preference implementation;
there is no retained unconditional HUD rendering change.

## Cross-sector correction

Read-only review during the initial matrix found two existing checkpoint issues.
Regression tests reproduced both: a connected player in `acamas` had zero
checkpointed playtime after 30 seconds, and two loaded sectors consumed 16
checkpoint entries during one global tick rather than eight.

Checkpoint work now runs once at the end of the global tick. Its periodic player
list includes connected players from every sector. New tests verify both global
budgeting and cross-sector player coverage. The immediate transaction paths and
background batching policy are unchanged. Focused persistence tests and the
production build pass after this correction.

The first local default matrix was deliberately interrupted between measurements
to make this correction. It retains **16 completed, valid cases**, all of which
also passed strict cadence, with no cleanup errors: all five workloads at 4, 8,
and 16 players, plus 32-player convoy. Its `complete=false` and recorded SIGINT
are preserved; it is not presented as a completed 20-case matrix. The final
corrected build is validated separately at 32 players before deployment.

## Final corrected local 32-player matrix

All five standard workloads completed on the corrected build, following a fresh
local world reset. All passed workload, client-consumption, generator-headroom,
and **strict cadence** checks. There were no missing input acknowledgments or
cleanup errors. Measurement remained 30 seconds after 15 seconds of warmup,
with two server cores, `GOMEMLIMIT=300MiB`, and default `GOGC=100`.

| Workload | Earlier Go CPU | Corrected Go CPU | Max snapshot gap |     Worst-client ACK p95 |
| -------- | -------------: | ---------------: | ---------------: | -----------------------: |
| convoy   |          2.73% |            2.60% |         36.38 ms |                 33.93 ms |
| spread   |          3.73% |            3.33% |         35.53 ms |                 33.94 ms |
| contact  |          4.83% |            4.83% |         36.57 ms |                 34.72 ms |
| module   |          8.72% |            7.64% |         39.55 ms |                 34.35 ms |
| weapon   |          4.70% |            4.33% |         35.72 ms | no input edges in window |

CPU values in this table are isolated **Go-process percentages of one core**,
not local host CPU or Fly machine CPU. The earlier capture is release 109's
local default matrix. World/target histories and the intervening release 110
checkpoint fix differ, so these observations are not a controlled attribution
of the change to one-second batching. In particular, mining was 7.64% versus
8.72% earlier, about 12.4% lower in these samples; the SQLite microbenchmark
must not be substituted for that whole-game measurement.

For mining, worst-client snapshot-gap p95 was 34.34 ms, maximum 39.55 ms;
input-ACK p95 was 34.35 ms, maximum 39.22 ms. All 32 clients performed the
validated mining workload. The ten-minute server interval covering this phase
reported a 7.46 ms maximum simulation call, zero overruns/catch-ups, and
41.3 MiB of Go heap at the interval boundary. No once-per-second delivery pause
was observed in this local matrix.

Evidence: `final-local32-matrix.json.gz`, `local32-audit.json`, and
`local-final32-server.log` in the raw evidence directory.

## Release 111 deployment and live cooldown

The final production build passed and its server artifact was verified as a
statically linked, stripped executable. Release **111** started on the existing
Machine at **18:05:17.195 UTC**. Health checks pass; the world volume and two
shared vCPUs/512 MiB configuration were preserved. The earliest live load is
**18:15:17.195 UTC**. The live runner enforces this ten-minute guard. Local
watcher and frontend services created for this investigation were stopped after
local validation; no temporary browser remains.

### Live cadence limitation

The 16-player convoy measurement observed one shared arrival gap of up to
192.84 ms, failing strict cadence despite passing workload, client-consumption,
and generator-headroom checks. No input acknowledgments or intermediate tick
IDs were missing. Connection logs reported all 1,491 snapshots for 1,491 ticks,
a maximum emitted tick-ID gap equivalent to 33.3 ms, and no window or buffer
stalls. That tick-ID statistic does not measure wall-clock send spacing. The server-load
interval covering this case reported a 28.59 ms maximum simulation call, zero
overruns/catch-ups, and 6.91 ms total GC pause time over ten minutes.

These observations point toward delivery, transport, or measurement scheduling
for this occurrence; they do not identify its exact cause. It must not be
presented as a 193 ms simulation pause, nor as proof that clients cannot feel
an occasional interruption. The live quota qualification and strict cadence
qualification remain separate. This server suite does not measure rendered
browser frames.

At 32 players, convoy also failed strict cadence: four clients had gaps over
100 ms, maximum 116.64 ms, without missing measured tick IDs or input ACKs.
Its full connection lifetime, including warmup, contained brief snapshot-window
stalls. Contact reached a 233.96 ms snapshot gap and 266.37 ms input ACK maximum
(worst-client ACK p95 105.15 ms). Three clients had separate skipped-state
events; those were not a shared global tick skip. Contact connection logs show
window stalls without buffer stalls. The ten-minute server interval ending
19:16:30 reported one 82.69 ms simulation call and one catch-up, versus 18,000
ticks. This interval spans preparation and multiple workloads and cannot locate
that call in a particular measured window. Occasional live interruption remains
possible; reducing CPU does not prove it has been eliminated.

The live 32-player mining case completed within the unchanged 600-second
preparation budget and passed strict cadence, client consumption, and generator
headroom, with zero missing input acknowledgments. Its worst-client snapshot
gap p95 was 37.79 ms, maximum 74.19 ms; input ACK p95 was 51.37 ms, maximum
94.38 ms. Machine CPU was 16.07%, still above the sustained ceiling and reliant
on credit. This is not a rendered-browser frame measurement or a controlled
live before/after CPU comparison.

The ten-minute server interval ending 19:26:30, covering mining preparation
and measurement, recorded three simulation calls over the 33.3 ms step budget,
maximum 44.54 ms, and zero catch-up batches. Total GC pause time was 21.53 ms;
heap at the boundary was 208.5 MiB. These are whole-interval observations,
separate from the passing measured-window cadence check.

## First unchanged live suite attempt

The default runner traversed all 20 cases between 18:15:37.754 and
19:34:51.034 UTC, starting 10.34 minutes after deployment. Nineteen cases
completed valid measurements; 16 of those passed strict cadence. The final
32-player weapon case failed its post-warmup staging check before measurement,
and the CLI exited with status 1. The capture's `complete=true` means traversal
finished; it is **not** a fully passing suite. There were no cleanup errors.

The rejected weapon worker's diagnostics show client 28 still travelling at
35.15 units/second with nonzero spin and turn, despite an intact loadout and
recent snapshots. Other ships had already settled. This is a staging/readiness
failure, not an established persistence fault; the existing check is retained.
No timeout, workload, readiness condition, or gameplay tuning was changed.

The Machine identity, image, runtime sizing, and passing health checks were
unchanged throughout the attempt. Across 321 enclosing quota samples, balance
was 171.63 CPU-seconds initially, at least 171.63 throughout, and 350.70 at the
end. The throttle counter remained zero. The enclosing machine CPU interval
averaged 4.38%, with 3.06 seconds of steal time across 79.75 minutes. This
qualifies the attempt's no-throttling observation, **not** the missing final
weapon measurement. A fresh unchanged full-suite retry is recorded separately.

Evidence: `live-full-matrix.json.gz`, `live-window.json`,
`live-attempt-audit.json`, `quota-complete-live.json`, and
`machine-before-live.json`/`machine-after-live.json`.

## Second unchanged live suite attempt

The same release, Machine instance, volume, world, and runtime configuration
were retained. No restart or reset occurred between attempts. The default runner
started at 19:35:58.954 UTC and finished cleanup at 20:48:08.271, about 72.16
minutes later. The original default player counts, five workloads, 15-second
warmup, 30-second measurement, 600-second preparation budget, and one repetition
were preserved. **All twenty cases measured**, but only nineteen passed
workload/client validation. The CLI exited with status 1; no cleanup errors or
missing input acknowledgments were recorded.

The final weapon case passed post-warmup readiness, then client 22 lost required
modules during firing. Its autogun remained present with ammunition, but other
modules were gone and activation/firing fell to about 54% of snapshots.
Diagnostics establish the damaged loadout; they do not establish what struck
it. This is a failed workload, not a qualified 32-weapon CPU comparison. The
existing damage rules and benchmark checks were preserved. The full-validation
auditor rejects this capture; a separate attempt auditor checks quota and
Machine continuity while explicitly retaining the failure.

| Players | Convoy | Spread | Contact | Mining | Weapons |
| ------: | -----: | -----: | ------: | -----: | ------: |
|       4 |  1.33% |  1.73% |   1.97% |  4.33% |   1.53% |
|       8 |  1.07% |  2.30% |   2.23% |  6.63% |   2.40% |
|      16 |  2.50% |  3.10% |   4.10% | 11.27% |   4.17% |
|      32 |  4.13% |  6.60% |   9.43% | 18.34% |  7.50%* |

Values are **Fly whole-machine CPU**, averaged over its two vCPUs, using the
unchanged observer's available counter window. `*` marks the invalid weapon
workload; its number must not be ranked as a healthy result. Larger live CPU
samples than the first attempt illustrate changing world/target histories;
these are not a controlled before/after comparison.

Across 291 enclosing quota samples, credit began at 355.47 CPU-seconds, never
fell below that, and ended at 453.76. The throttle counter stayed at zero,
without a reset. The baseline stayed at 0.125 CPU-equivalents. The enclosing
whole-machine CPU interval averaged **5.10%** and included preparation,
warmup, measurement, the failed workload, and cleanup. Machine identity,
image, guest sizing, memory limit, and passing health were verified afterward.
This establishes no throttling during the actual attempt; it does not turn an
invalid weapon workload into a fully qualified suite. A fresh all-valid default
suite remains outstanding.

### Smoothness limits of the retry

Eleven of twenty cases passed strict cadence. The 32-miner case passed with
worst-client snapshot gap p95 38.50 ms, maximum 87.94 ms; input ACK p95
52.69 ms, maximum 92.74 ms, with no missing acknowledgments. The local and both
live mining measurements support continued smooth delivery for those captures,
not a guarantee for every later session or rendered browser frame.

Other workloads still had important outliers. In 32-player contact, worst-client
snapshot-gap p95 was 72.81 ms, maximum **390.85 ms**; input ACK p95 was
205.85 ms, maximum **631.73 ms**. These could be felt by a player. Spare CPU
credit does not eliminate or explain them. Earlier retry intervals had no tick
overruns; the intervals ending 20:36:30 and 20:46:30 each had three calls over
the step budget, maxima 41.08 and 61.31 ms, with no catch-up batches. Coarse
interval counters cannot assign a particular call to an individual arrival gap.

A review of disconnected-player handling found that hidden disconnected ships
are already excluded from the tick roster, and ships leave simulation after
the existing reconnect grace period. No additional eviction change was made
on an unmeasured hypothesis. Diagnosing delivery/window stalls and the weapon
fixture's environmental failures remains separate work; neither gameplay damage
nor client rendering was altered to hide them.

Evidence: `live-retry-matrix.json.gz`, `live-retry-window.json`,
`live-retry-attempt-audit.json`, `quota-complete-retry.json`,
`machine-before-retry.json`/`machine-after-retry.json`, and
`live-after-retry.log`. The archived SQLite baseline compiler overlay also
passed a compile-only reproducibility check. The final production server SHA256
still matches the deployed artifact. Temporary local services and browser
captures are closed; both live runners completed cleanup.
