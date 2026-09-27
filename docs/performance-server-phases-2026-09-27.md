# Server CPU categories, 27 September 2026

Follow-up implementation: [persistent replication and movement storage](performance-persistent-state-2026-09-27.md).

Baseline source: `442548e1fb663d5d4d75c5747c866a299b4f78bc`, confirmed as the
live image revision by `fly status`, after the production segment-cache fix. This investigation changes benchmark tooling and
records results; **no gameplay, server configuration or deployment changes are
retained**. Three small production experiments were reverted after measurement.

## What consumes time with three players?

The largest non-collision cost is **preparing snapshots and comparing deltas**,
not encoding the final packet. Movement and entity updates come next. Region
queries, generation and entity lifecycle together are the third target.

Two warmed measurements of each convoy, spread and contact route were taken
through the real production property-mangling and compression pipeline. Each
measured route lasts 120 simulated seconds; its warm-up plus measured replay
lasts 260 simulated seconds. Each child has a 290-second wall-clock timeout.
There were no 20-minute tests.

| Category                                             | Mean µs per server tick | Share of measured foreground work |
| ---------------------------------------------------- | ----------------------: | --------------------------------: |
| Collision/physics, including proxy synchronization   |                  314.41 |                            40.97% |
| Snapshot preparation and delta comparison            |                  217.30 |                            28.31% |
| Entity movement, update scheduling and modules       |                   99.85 |                            13.01% |
| World bookkeeping and contact gameplay               |                   49.24 |                             6.42% |
| Region entity creation, waking, sleeping and removal |                   34.00 |                             4.43% |
| Region queries and range filtering                   |                   21.50 |                             2.80% |
| Final outgoing JSON encoding                         |                   15.64 |                             2.04% |
| Procedural region/station generation                 |                    9.51 |                             1.24% |
| Session bookkeeping                                  |                    5.88 |                             0.77% |
| Input decoding/validation and input handling         |                    0.12 |                             0.02% |

The percentages are **exclusive elapsed-time hotspot estimates**, not a claim
that those exact fractions of Fly's total CPU are known. Nested phases are
subtracted from their caller, so region generation is not also counted as query
time. Instrumentation hashes and client-side wire construction are excluded.
Synchronous GC pauses can still land inside a phase. Background GC/JIT CPU is
not attributed by these timers.

Total measured foreground work averaged **0.767 ms/tick**. Actual process CPU
from `process.cpuUsage()` averaged **0.864 ms/tick** in those instrumented runs,
including harness and V8 work. At 30 server ticks/second that is approximately
25.9 CPU milliseconds per second on this local machine. The difference must
not all be called GC. This Ryzen 7 5800X3D runs Node 26.8.2; the Fly guest runs
26.10.0. These are not direct Fly CPU-utilization predictions.

The replay uses real game sessions, replication, serialization and production
input parsing, with three players holding thrust and periodically steering.
Held controls send transitions only, so parsing is appropriately rare. It does
not model real WebSocket framing, kernel networking, TLS, browser rendering or
other users on the public server. Encoding is measured; real socket transport
is not. Larger player counts or frequent docking/mining need separate workloads.

Across convoy / spread / contact respectively, snapshot preparation took
188 / 254 / 210 µs per tick, entity updates took 92 / 116 / 92 µs, and combined
region work took 62 / 68 / 64 µs. The priority order holds across routes.

## Three optimization priorities

### 1. Persistent replication state, rather than reconstructing every field

`replicateEntity()` recreates a full record, including craft module/cargo state,
then normalization and per-player loops discover which fields did not change.
Per-tick sharing across players and segment-geometry caching already exist;
simply adding those again would achieve nothing.

The next useful design is a persistent normalized record per entity, with
separate revisions for geometry, inventory/modules and mutable motion. Each
observer still needs its own baseline and membership. Immutable fields could
reuse their normalized values across ticks; only changed fields would need
comparison/copying. This trades additional retained state for fewer allocations,
getter traversals and array serializations.

This needs explicit invalidation for damage, fracture, cargo transfer, module
activation, paint, docking, respawn and in-place array edits. A stale-cache bug
would be a correctness regression. Keep the existing replication path as an
oracle while developing it, including the production-mangling regression.
An extra 1 KiB per active entity would cost about 0.2 MiB at the tested maximum
of 209 entities, before observer bookkeeping; that is an illustrative budget,
not a measured implementation size.

The measured 28.3% share gives an upper bound: cutting this phase in half would
save roughly **14% of foreground work**, not 50% of total server CPU. A detailed
instrumented convoy probe attributed roughly two-fifths of snapshot time to
record extraction and the remainder to normalization/deltas, although its
per-entity wrappers add overhead.

Trial: caching serialized frozen outlines, combined with the movement shortcut
below and region-list caching, changed initial convoy CPU from 0.63127 to
0.63087 ms/tick—effectively flat. That does not demonstrate an isolated outline
cache win. It was removed.

### 2. Reuse update data before changing simulation frequency

`updateEntities()` builds observer and scheduling arrays each tick, creates a
schedule object per entity, and dispatches the tier's substeps. Entity updates
perform movement, carrier interactions, module activation and rounding. The
world update also creates a previous-transform map and contact-owner lists.
Those latter allocations belong to the separate 6.4% bookkeeping category.

Retain reusable scheduling entries and previous-transform storage keyed by
entity identity, pruning removed entities. Recompute distances and tier choices
as needed, but avoid allocating the same scaffolding every tick. Budgeting even
1 KiB per active entity for scratch would be small compared with the available
memory. Validate input subdivision, tier transitions, collision order and
packet hashes against the current implementation.

Trial: skip vector scaling/integration when velocity is already zero. The
combined trial above did not show a useful whole-server win, and it was removed.
Do not skip an entire stationary entity update: decay, carrier motion, module
activation and pending update time can still change. Distant updates already
run less frequently; another blanket interval reduction is a gameplay change.

### 3. Cache region candidates and avoid rebuilding unchanged world state

World-region work totals **65 µs/tick, or 8.5%**. Only 1.2 percentage points are
actual procedural generation during these flights. Most is managing active
entities and repeatedly filtering existing descriptions.

Trial: flatten each player's asteroid/wreck candidates only when the cached
region rectangle changes, rather than on every query. Keep exact per-tick
radius filtering and invalidate on load/unload/remove. A profiled convoy pair
reduced the query phase from 17.4 to 12.0 µs/tick. But repeated uninstrumented
ABBA comparisons found total CPU changes of **-1.1%, +0.8%, +0.3%** across the
three routes (positive means savings). That is not a dependable whole-server
improvement; the extra cache was removed.

A more substantial version would retain spatially indexed active/sleeping
membership and process boundary crossings instead of scanning all candidates.
It must handle moving entities, runtime fragments, destroyed sources, observer
joins/leaves and exact load/unload distances. A bounded cache of reusable
procedural geometry could also avoid reconstruction when revisiting a boundary,
but the existing procedural/geometry caches should first be measured for misses.
Keeping every previously visited live entity would waste memory and could
silently change the current respawn/sleep semantics.

## Spending memory to reduce CPU: measured V8 experiment

Read-only commands in fresh Node subprocesses on the live VM reported heap
limits of 268 MiB by default, 268 MiB with a 4 MiB semi-space, and 304 MiB with a
16 MiB semi-space. This is consistent with the default 4 MiB setting; it is not
an inspection of the running game's occupied heap.

V8's young-generation size depends on the semi-space limit. Raising the limit
can reduce collection frequency at a memory cost; adding 12 MiB to this setting
adds up to 36 MiB to young-generation capacity. Increasing only the old-space
limit is a different experiment.
[Node CLI documentation](https://github.com/nodejs/node/blob/main/doc/api/cli.md#--max-semi-space-sizesize-in-mib).

Matched production replays, two runs per setting per route in ABBA order:

| Route   | CPU ms/tick, 4 → 16 MiB | CPU reduction | Maximum observed process RSS, MiB, 4 → 16 | Mean GC duration, ms, 4 → 16 |
| ------- | ----------------------: | ------------: | ----------------------------------------: | ---------------------------: |
| Convoy  |         0.6728 → 0.6539 |          2.8% |                             139.2 → 169.5 |                256.4 → 127.2 |
| Spread  |         0.9574 → 0.9485 |          0.9% |                             182.0 → 216.8 |                349.9 → 159.7 |
| Contact |         0.8368 → 0.7989 |          4.5% |                             178.8 → 221.8 |                310.6 → 202.2 |

GC durations and peak RSS cover the whole child process, including warm-up;
CPU ms/tick covers the measured replay. GC duration is elapsed collection time,
not total background GC thread CPU, and cannot be added to the phase table.
Collection counts fell from approximately 1,354–1,650 to 354–419 per child.
Peak RSS is from `process.resourceUsage().maxRSS`, not just the final sample.
The local old-space limit remained the host default, so this does not fully
reproduce the Fly VM's memory constraints or real-time GC scheduling.

Initial single-run sweeps also tried 1, 8, 32 and 64 MiB. In the convoy sweep,
32 and 64 MiB used 0.6313 and 0.6351 CPU ms/tick respectively, with final RSS
187 and 257 MiB. Those early runs did not record peak RSS. There is no evidence
here that spending four times the game's memory improves CPU proportionally.

**Recommendation:** a controlled deployed trial of
`NODE_OPTIONS=--max-semi-space-size=16` is reasonable before attempting larger
heaps. The repeatable GC reduction is stronger evidence than the small total
CPU savings, especially the spread route's 0.9%. Do not claim a fixed Fly saving
until it is measured there. No VM size, CPU tier or Node flags were changed.

## Validation and reproduction

All phase-profile, cache-trial and heap-size comparisons matched packet hashes,
bytes, packet counts, final positions and final/maximum entity counts. The
production pipeline matters: the previous investigation found a bug that
source-only benchmarks could not expose.

See [benchmark commands](../benchmarking/README.md) and
[raw results](../benchmarking/results/2026-09-27-server-phases.json).
`npm test` (including production build) and `npm run lint` passed. All changed
files pass formatting and `git diff --check`. Main JS remains 94,647 raw /
42,093 gzip-1 bytes; server JS remains 76,964 raw / 33,397 gzip-1 bytes. HTML,
docked and sound chunk sizes are also unchanged. No loading boundaries changed.
The existing main-bundle 14 KB warning remains.

Only benchmark scripts, results and documentation are retained. The live work
was limited to read-only status and short Node heap-limit probes; the game
process was not restarted, reconfigured or profiled in this pass.
