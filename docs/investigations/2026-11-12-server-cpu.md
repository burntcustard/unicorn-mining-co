# Server CPU and Delivery Investigation (November 12, 2026)

## Result

Release 131 reduces snapshot traffic without changing simulation, snapshot, or
benchmark measurement timing. Its 32-player live contact case delivered about
59% fewer snapshot payload bytes than the earlier release 130 case and had
better observed snapshot and acknowledgment tails. A controlled local
comparison of the same contact workload found about 64% fewer bytes. These are
application payloads, not total wire traffic, and the live comparison is not a
controlled A/B: worlds and network conditions differed.

The live 4- and 32-player matrix did **not** pass as a single run. Four-player
spread had one delivery gap above 100 ms; 32-player mining lost readiness before
measurement, and 32-player weapon failed its workload checks. Each later passed
in a separate retry; an intermediate weapon retry also failed. Those successes
do not erase the original failures. Sampled Fly throttle counters remained zero
and CPU balance grew over each audited capture interval. Balance did briefly
fall within the loaded browser window, so growth was not continuous.

The live world was preserved. Benchmarks created accounts and changed ordinary
world state, so captures are not identical even when the world is not reset.
The assessed change adds 993 net source and test lines, excluding documentation.

## Method

The local host was an AMD Ryzen 7 5800X3D. Before the extensive local session,
the Go watcher was stopped, `npm run reset-world:local` was run, and the normal
watcher restarted. The baseline full 4/8/16/32-player matrix completed all 20
cases with valid workloads, generator headroom, and strict cadence. The server
ran with `GOMEMLIMIT=600MiB`, default `GOGC=100`, four logical CPUs selected by
`--cores 4`, and a SIMD Go build; the captures record these settings. The flag
changes affinity, not the memory budget. Browser and generator processes were
not restricted to those four CPUs.

The standard server cases retained 15 seconds of warmup and 30 seconds of
measurement. Module ships find separate real asteroids and drill; weapon ships
equip and launch normally. Local Go-process CPU excludes the generator and is
not directly comparable to Fly whole-machine CPU. The latter includes the OS,
and its case samples cover only the common metric scrapes wholly inside the
window, typically 15 seconds of a 30-second case. Timing, traffic, and
acknowledgment measurements are application observations, not isolated wire
latency. Repeated local runs also see an evolving world and different targets.

The live machine was `8ed9e11b37e078`, release 131, with four shared vCPUs,
1 GiB RAM, `GOMEMLIMIT=600MiB`, and default `GOGC=100`. Its 0.25-CPU sustained
quota corresponds to 6.25% of the four-vCPU machine, or 25% of one core. The
machine started at 18:53:50 UTC and the first benchmark report was created at
19:16:20 UTC, more than ten minutes later. The local source and build were
deployed directly without a commit or push.

## Changes and Local Evidence

An initial local 32-player contact packet sample attributed 88.9% of its
3,972,663 bytes to module arrays: 34.8% of the entire payload was shades, 26.2%
was segment values, and 18.1% was module type, mount, and ID. A compact
lossless representation uses integer and segment encodings and packs common
lowercase `#rgb` shades, with exact fallback encodings for other values. It
continues to send complete module arrays when those arrays change.

The format is negotiated per connection. Previously opened clients receive the
legacy encoding; a new client can fall back to a pre-upgrade server after an
extended hello is rejected. The shared fragment cache distinguishes formats, so
legacy and compact clients can observe the same entities together. Cargo and
hangar data remain compatible. Tests cover Go-to-TypeScript decoding, malformed
data, mixed-format sockets, reconnects, fallback, and unusual values and shades.
The server benchmark can explicitly select `--module-encoding legacy` or
`compact` when comparing versions.

In two sequential local contact comparisons, the 32 clients received
638.9 MB and 635.7 MB with legacy encoding versus 228.3 MB and 229.5 MB with
compact encoding. Go-process CPU was 5.13% and 5.37% of one core versus 4.97%
in both compact runs. All four cases passed strict cadence and generator
headroom. The payload difference was consistent; the much smaller CPU
difference is sensitive to world and runtime variation. An independent local
mining comparison received 43.3 MB legacy versus 26.6 MB compact; Go-process
CPU was 12.53% versus 12.63%, which does not establish a CPU saving there.

The HUD stops requesting sector-map updates while the collapsed map already
has its initial data. It retries while data is pending, requests immediately
when opened, and retains the expanded-map update interval. Cold starting-sector
map generation measured about 72 microseconds on this host, so asynchronous
generation was not adopted. A redundant collision identity comparison was
removed: repeated isolated collision-step samples improved by about 2.9%, but
the whole contact case did not establish a comparable end-to-end saving.
Experiments without a convincing result were not retained.

The integrated local 4-player matrix passed. In the integrated 32-player matrix,
spread exhausted its preparation budget while reserving corridors; the other
four cases passed. Later local spread preparation and a separate 32-player
weapon run passed after benchmark-only preparation improvements. They are
separate captures, not a retroactive pass for the original matrix. The weapon
preparation changes also informed the later live retries; no workload timing
was shortened.

Local raw data: [baseline](../../benchmarking/_local/cpu-pass-2026-11-12-baseline.json.gz),
[contact A/B](../../benchmarking/_local/cpu-pass-compact/),
[mining legacy](../../benchmarking/_local/cpu-pass-mining-legacy.json.gz),
[mining compact](../../benchmarking/_local/cpu-pass-mining-compact.json.gz),
[integrated 4](../../benchmarking/_local/cpu-pass-integrated-4.json.gz),
[integrated 32](../../benchmarking/_local/cpu-pass-integrated-32.json.gz),
and [spread retry](../../benchmarking/_local/cpu-pass-spread-stall.json.gz).

## Live Matrix and Retries

CPU below is Fly whole-machine usage expressed as a percentage of one core,
from the sampled portion of each active window. Workload validity and strict
cadence are separate. A dash means the case did not reach measurement.

| Players | Workload | Sample CPU | Workload                                          | Strict cadence                 |
| ------: | -------- | ---------: | ------------------------------------------------- | ------------------------------ |
|       4 | Convoy   |      2.66% | Pass                                              | Pass                           |
|       4 | Spread   |      3.53% | Pass                                              | Fail: one 116.57 ms client gap |
|       4 | Contact  |      3.67% | Pass                                              | Pass                           |
|       4 | Mining   |      5.00% | Pass                                              | Pass                           |
|       4 | Weapon   |      3.93% | Pass                                              | Pass                           |
|      32 | Convoy   |      6.27% | Pass                                              | Pass                           |
|      32 | Spread   |     12.47% | Pass                                              | Pass                           |
|      32 | Contact  |     12.33% | Pass                                              | Pass                           |
|      32 | Mining   |          — | Failed readiness before measurement               | Not measured                   |
|      32 | Weapon   |     12.27% | Fail: fitted part lost and firing below threshold | Pass                           |

The initial mining case lost current readiness when a ship lost its cargo
hatch; the captured states do not establish the exact collision or damage cause. The
separate mining retry passed all workload, headroom, and cadence checks at
23.87% of one core in its 15-second Fly sample. The initial weapon measurement
lost a required fitted part. Its first retry failed because two ships did not
meet the held-firing threshold; a second retry passed at 13.40% of one core in
its sample. Benchmark staging was improved between attempts to check additional
separation from other ships. The separate 4-player spread retry passed cadence.

For live contact, release 131's 32 clients received 220.0 MB of snapshot
payload versus 541.6 MB in release 130. Worst-client snapshot-gap
p95/p99/max changed from 54.34/99.32/186.15 ms to 37.90/42.22/83.63 ms;
worst input-ACK p95/p99/max changed from 140.96/300.22/339.91 ms to
58.86/73.05/136.39 ms. Release 130 failed cadence with individual skipped
states; release 131 passed, with no missing ACKs or skipped states. Sampled
whole-machine CPU was 16.73% versus 12.33% of one core. These are useful
observations, not proof that compact encoding alone caused the improvement.

For the successful live mining retry, payload was 24.2 MB versus 42.0 MB in
release 130. Both passed cadence; the worst gap was 65.57 ms versus 47.90 ms,
and worst ACK was 94.69 ms versus 68.77 ms. Their Fly CPU samples were 23.87%
and 25.08% of one core respectively. Different rocks, activity, and world
history prevent a precise causal comparison.

Raw data: [4-player matrix](../../benchmarking/_local/live-cpu-pass-4.json.gz),
[32-player matrix](../../benchmarking/_local/live-cpu-pass-32.json.gz),
[mining retry](../../benchmarking/_local/live-cpu-pass-mining-retry.json.gz),
[weapon retry 1](../../benchmarking/_local/live-cpu-pass-weapon-retry.json.gz),
[weapon retry 2](../../benchmarking/_local/live-cpu-pass-weapon-retry2.json.gz),
and [spread retry](../../benchmarking/_local/live-cpu-pass-spread4-retry.json.gz).

## Player Timing and Fly Quota

A separate live diagnostic ran one real browser alongside 32 mining protocol
clients for a 120-second mining window. All 20 steering and 20 firing inputs
were acknowledged; mean keydown-to-ACK was 27.61 ms and 29.90 ms respectively.
The browser subsequently maintained real drilling contact for about 15 seconds,
with seven observed damage changes. The 32-client workload and strict cadence
passed; the largest protocol-client gap and ACK were 80.84 ms and 84.81 ms.
This single-browser diagnostic has no remote observer, and its input and
drilling phases are separate. Its correction instrumentation does not cover
every large discontinuity or recovery path.

A separate quiet four-browser live test completed five steering and five firing
trials with no missing acknowledgments or observer events. Mean keydown-to-ACK
was 31.84 ms steering and 37.36 ms firing; the paired mean of three remote
observers was 53.81 ms and 45.56 ms respectively. Five trials do not bound
rare events and this test was not concurrent with the 32-player contact case.

The primary audit brackets the complete 4/32 suite and mining retry, including
preparation: sampled CPU balance rose from 520.99 to 870.18 CPU-seconds, with a
520.99 minimum and no throttle-counter increase. Separate audited intervals
for each weapon retry, the loaded browser run, quiet latency, and spread retry
also recorded no throttle increase and net balance growth. Within the loaded
120-second measurement, one sampled balance step fell by about 0.039
CPU-seconds despite net growth over its enclosing audit. A brief case above the
0.25-core sustained rate does not by itself prove throttling, and a positive
end-to-end balance change does not prove balance grew every moment.

Audits: [primary](../../benchmarking/_local/live-cpu-pass-primary-audit.json),
[weapon retries](../../benchmarking/_local/live-cpu-pass-weapon-audit.json),
[weapon retry 2](../../benchmarking/_local/live-cpu-pass-weapon2-audit.json),
[loaded browser](../../benchmarking/_local/live-cpu-pass-loaded-audit.json),
[quiet latency](../../benchmarking/_local/live-cpu-pass-latency-audit.json),
and [spread retry](../../benchmarking/_local/live-cpu-pass-spread4-audit.json).

## Validation

The production build, all 142 tests with `npm test -- --skip-build`, lint,
TypeScript and Go formatting checks, focused protocol tests, and the full
production-browser UI test passed. Tested and deployed artifact hashes matched.
The local [rendering](../../benchmarking/_local/cpu-pass-rendering.json) and
[NPC](../../benchmarking/_local/cpu-pass-npc.json) suites also completed. The
NPC collection cases did not complete a full trip within their 30-second
windows. The matrix failures and retries above remain separate from these checks.

## Module color follow-up

Ship shades already use the normal field revision mechanism. Module shades are
part of the module array, which is also replaced when animation, cooldown, or
other module state changes. The existing compact color escape is not used for
normal palette shades; removing the escape alone would not reduce their traffic.
It also remains relevant to compatibility with the existing wire format and
generic saved entities that store shade strings.

Two isolated, unshipped prototypes were compared locally with a fresh world at
the start of the session, four-core affinity, and a recorded `GOMEMLIMIT` of
600 MiB. The ordinary 30-second measurement and workload were unchanged.
The first sends colors on initial visibility and appearance changes and an
inheritance marker on subsequent module-only changes. A simpler refinement
reuses the existing module comparison to track appearance changes. Its focused
tests cover repainting, animation, reordering, replacement, nil and empty
shades, coalesced updates, mixed client formats, and compatibility fallback.
The prototype remains under `benchmarking/_local/color-delta-single/` and
`benchmarking/_local/color-delta-prototype/`.

In valid 32-player contact runs, the original compact format transferred
225.0 MB of snapshot payload, versus 181.2 MB for the first inheritance
prototype and 182.6 MB for the single-pass refinement. The matching compact and
first inheritance runs used 4.633% and 4.633% of one local Go core,
respectively; the refinement used 4.595%. These are single runs with different
world histories, so they show less traffic but do not establish a CPU or
latency improvement. Both 4- and 32-player inheritance runs passed their
workload, cadence, and generator-headroom checks.

The other prototype replaces a recognized complete palette with a versioned
two-byte palette reference, retaining the existing exact encoding for other
values. Its frozen palette contract does not depend on later gameplay palette
ordering or edits. This is simpler than retaining appearance history but sends a
palette reference repeatedly. On the same server build, valid 32-player runs
transferred 225.3 MB in the compact format and 181.5 MB with palette references;
the corresponding Go process CPU figures were 4.466% and 4.529% of one core.
These individual measurements do not establish a CPU or lag improvement.
Both 4- and 32-player palette runs passed their workload, cadence, and
generator-headroom checks. The prototype is under
`benchmarking/_local/palette-prototype/`.

The current uncommitted optimization work already uses roughly 990 net source
and test lines relative to `HEAD`. Either new protocol requires additional
compatibility and correctness tests beyond the earlier 1,000-line budget. No
production protocol change from this follow-up has been applied or deployed.

Raw captures: [compact control](../../benchmarking/_local/colors-delta-compact.json.gz),
[inheritance](../../benchmarking/_local/colors-delta-inherit.json.gz),
[single-pass inheritance](../../benchmarking/_local/colors-single-inherit.json.gz),
[palette compact control](../../benchmarking/_local/colors-palette-compact.json.gz),
[palette references](../../benchmarking/_local/colors-palette-index.json.gz),
[four-player inheritance](../../benchmarking/_local/colors-delta-four.json.gz),
and [four-player palette](../../benchmarking/_local/colors-palette-four.json.gz).

## Sparse modules and lossless motion packing

The subsequent implementation makes the compact snapshot format mandatory and
removes the older wire negotiation and migration paths. A module array carries a
bit for each changed module; previously received modules and unchanged palettes
are restored as each packet arrives, before render coalescing. Palette IDs come
from the current shared color catalog. New visibility, replacement, and layout
changes receive complete module layouts. Thrust and turn have compact codes for
common discrete controls and retain exact values for other controls.

Moving coordinates and angles also use shorter encodings when their existing
float64 bits have zero low bytes. Values that cannot be represented exactly in
those encodings retain all eight bytes. The game tick, snapshot cadence, and
motion precision are unchanged. Tests include actual Go-to-TypeScript packets,
stale observers, re-entry, palette changes, coalescing, nested cargo, malformed
data, production-mangled client state, and a physical two-client paint and
animation scenario.

Three 32-player contact runs for each variant used the same 30-second workload,
15-second warmup, four-core affinity and `GOMEMLIMIT=600MiB`. A separate Linux
process CPU clock measured all Go threads with sub-millisecond read uncertainty.
The original compact format averaged 224.91 MB of snapshot payload and 4.652%
of one core; sparse modules averaged 91.03 MB and 4.424%; adding lossless motion
packing averaged 77.80 MB and 4.279%. Every case passed workload, cadence and
load-generator headroom checks. These are sequential runs in a changing world,
not proof of a precise causal CPU or latency improvement; no CPU increase was
observed in these comparisons.

The production build, full 142-test suite, lint, and TypeScript and Go format
checks passed. The live database was inspected with explicit authorization using
a separate encrypted Fly volume snapshot: SQLite integrity and the new server's
full persistence initialization passed. The temporary inspection machine,
cloned volume, and local copy were removed; Fly retains the encrypted snapshot
for five days.

Raw captures: [original](../../benchmarking/_local/payload-clock-original.json.gz),
[sparse modules](../../benchmarking/_local/payload-clock-current.json.gz), and
[sparse plus packed motion](../../benchmarking/_local/payload-clock-packed.json.gz).

In the final local matrix, all five workloads passed at both four and 32
players. At 32 players, contact transferred 78.03 MB, mining transferred
19.08 MB, and weapons transferred 26.69 MB. Spread required 465 seconds to
reserve clear corridors before its unchanged measurement. These matrix cases
use the normal watcher and share the freshly reset world throughout the session.
Raw captures: [four-player matrix](../../benchmarking/_local/payload-final-4.json.gz)
and [32-player matrix](../../benchmarking/_local/payload-final-32.json.gz).

Spread preparation could also leave a ship without a reservation when a single
previously selected corridor had a safe alternative. The reservation step now
tries that bounded swap before sending the unassigned ship to survey again,
using the same separation test. A replay of the recorded conflict and focused
crossing tests pass; separate [four-player](../../benchmarking/_local/spread-swap-4.json.gz)
and [32-player](../../benchmarking/_local/spread-swap-32.json.gz) spread trials
also passed. The 32-player trial took less time to prepare, but different paths
and world history prevent attributing that time difference to the swap alone.

The production-browser UI check, all five rendering cases, and the local
four-browser latency suite passed. The latency capture completed five steering
and five firing trials with no readiness failures or missing authoritative
acknowledgments. Its mean keydown-to-acknowledgment times were 23.0 ms for
steering and 31.8 ms for firing; these small local samples are not a bound on
rare or remote latency. Captures: [latency](../../benchmarking/_local/payload-final-latency.json),
[four rendering cases](../../benchmarking/_local/payload-final-rendering.json),
and [pirate rendering](../../benchmarking/_local/payload-final-render-pirate.json).

The initial [NPC suite](../../benchmarking/_local/payload-final-npc.json) stopped
in the second active-collector repetition. Its authoritative events show all
six pickups occurred during the fixed warmup, leaving no pickup in the measured
window. A separate unchanged [collector retry](../../benchmarking/_local/payload-npc-collector-retry.json)
passed with one in-window pickup. The failed window is retained and is not a
valid active-collector CPU comparison.

The benchmark now allows up to three total attempts for a single-lane collector
case only when authoritative events show that all fixture items were picked up
before capture and no pickup occurred during the capture. Each rejected attempt
is retained separately, and exhausting the attempts still fails the run.
Concurrent cases keep the original strict validation. The 15-second warmup,
30-second measurement, and gameplay timing are unchanged.

The complete [NPC rerun](../../benchmarking/_local/payload-final-npc-retry.json)
recorded all 21 requested windows across seven scenarios. One active-collector
attempt was rejected because its six pickups occurred 5.73–8.30 seconds before
capture; the subsequent attempt passed with two in-window pickups. The rejected
window remains in the report and is excluded from the successful results, while
suite-wide CPU counters include its preparation and capture.

In the collection scenarios, Courser and Finch each collected every item in
one of three runs, at 29.77 and 28.48 seconds respectively. Across their three
runs they collected 87.5% and 83.3% of items on average. Neither completed a
full pickup-and-docking trip within the 30-second window, so these observations
do not establish full-trip completion or timing.

A separate paired collector comparison used fresh copies of the same local
world, four-core affinity, `GOMEMLIMIT=600MiB`, and the same warmup and capture
durations. Across four first-window samples, baseline process CPU was 0.6582%,
0.7032%, 0.7088%, and 0.6462% of one core; current process CPU was 0.7722%,
0.6215%, 0.7719%, and 0.7060%. Each window had the same starting layout and
81 occupied samples, with nearly identical pickup timing. The respective
means were 0.6791% and 0.7179%, but variation between runs is too large to
establish a 1% CPU bound. The [paired captures](../../benchmarking/_local/npc-cpu-paired/README.md)
retain each measurement and describe the comparison procedure.

A later encoder experiment passed field IDs rather than the full protocol
structure to motion packing. Three valid 32-player contact captures averaged
4.630% of one Go core, compared with 4.279% in the earlier packed-motion runs.
The captures used a changing world and cannot establish the cause of this
difference. The experiment was reverted because it did not demonstrate a CPU
improvement. Its [capture](../../benchmarking/_local/payload-clock-final.json.gz)
is retained separately from the implementation that was kept.

To isolate simulation and snapshot encoding from real-time scheduling, an
in-process diagnostic replay ran the same collector fixture on both versions
with a simulated clock, four-core affinity, and `GOMEMLIMIT=600MiB`. It retained
the ordinary simulation step, 15-second warmup and 30-second capture, but ran
without real sockets or persistence. Each capture produced 900 packets, five
warmup pickups and one in-window pickup. Four alternating blocks of 40 captures
averaged 18.965 ms of process CPU per capture for the baseline and 18.798 ms
for the current implementation; payload fell from 79,266 to 70,118 bytes per
capture. The current implementation allocated 315 additional objects per
capture. These accelerated results do not establish a 1% bound for the
real-time server, and the earlier collector measurements remain inconclusive.

Escape analysis identified a `ModuleDelta` allocation per changed non-full
record. A separate compiler-overlay prototype reused a batch-owned scratch
value and removed those 315 allocations, while retaining the same replay
payload and pickup counts. In six alternating blocks, it averaged 19.190 ms
of process CPU per capture versus 18.813 ms without scratch reuse. The variation
does not establish the cause, and the prototype was not kept because it did
not demonstrate the required CPU improvement. The diagnostic source, profiles,
and individual results remain in the ignored
[`npc-cpu-replay`](../../benchmarking/_local/npc-cpu-replay/) directory.

## Interrupted live suite

Release 132 was deployed to the existing machine without resetting the world.
After the required ten-minute recovery period, the four-player convoy, spread,
and contact cases passed. During mining preparation, a separate deployment
replaced release 132 with release 133: the old server shut down cleanly and the
new instance started at 01:06:42 UTC. The mining clients then lost their
connections. The following weapon case received invalid snapshots before
measurement. The replacement release's public client uses the older snapshot
format, consistent with a wire-format mismatch against the benchmark client.
The machine remained healthy and its original world volume remained attached.

The [partial four-player capture](../../benchmarking/_local/payload-live-4.json.gz)
retains both failed cases. The [before](../../benchmarking/_local/payload-live-before.json)
and [after](../../benchmarking/_local/payload-live-failed-after.json) markers
span different instances and image digests, so they cannot establish a valid
whole-suite CPU-balance or throttle comparison. No 32-player live case was run
after the interruption.

## Merged main and navigation beacons

The snapshot changes were reapplied on main commit `0479864e`, which adds
navigation beacons and map zoom. The Go catalog was regenerated with both
the beacon specification and module palettes. Cross-language coverage now
includes a beacon snapshot and a ship map marker with a nonempty sender role;
a damaged-beacon save/restore test and a production-browser map zoom check
also pass.

The [four-player](../../benchmarking/_local/merged-main-4.json.gz) and
[32-player](../../benchmarking/_local/merged-main-32.json.gz) local matrices
each completed all five workloads with valid workload, cadence and generator
headroom checks. The 32-player contact case transferred 78.05 MB during its
30-second window.

A separate contact comparison used three alternating runs per variant and
player count. Each run started from a separate, identical SQLite copy of the
same local world, used four-core affinity and `GOMEMLIMIT=600MiB`, and kept the
15-second warmup and 30-second capture. The Linux process CPU clock covers all
Go threads. All twelve valid windows passed workload, cadence and generator
headroom checks:

| Players | Version         | Mean snapshot payload | Mean Go CPU, one core |    CPU range |
| ------- | --------------- | --------------------: | --------------------: | -----------: |
| 4       | Main `0479864e` |              10.23 MB |                1.180% | 1.156–1.200% |
| 4       | Merged          |               1.51 MB |                1.173% | 1.173–1.174% |
| 32      | Main `0479864e` |             634.45 MB |                4.983% | 4.850–5.117% |
| 32      | Merged          |              79.46 MB |                4.573% | 4.567–4.579% |

The fetched main uses the older full-width snapshot format; its payload is a
different baseline from the 225 MB compact prototype discussed above. These
few sequential local runs do not establish a universal 1% CPU bound or a live
quota result. The [comparison procedure and captures](../../benchmarking/_local/cpu-clock-main-0479864/README.md)
retain environment and individual results. An initial baseline attempt used the
wrong decoder because it ran from the wrong directory; its
[failed capture](../../benchmarking/_local/main-0479864-contact-baseline-4-1-wrong-codec.json.gz)
is retained and excluded from the table.

An additional isolated snapshot of the live volume after release 133 passed
SQLite integrity checks with schema 7, 673 player records and 2,904 entity
records. The merged server completed actual catalog loading, persistence open
and game-session persistence initialization against that copy. The temporary
inspection machine, cloned volume and local copy were removed, while the
original live machine and volume remained unchanged. Fly retains the encrypted
snapshot for five days. No subsequent live benchmark is represented here.
