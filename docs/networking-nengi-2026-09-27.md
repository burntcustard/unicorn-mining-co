# Networking lessons from nengi RC.127

This records the first investigation. The [alpha follow-up](networking-alpha-2026-09-27.md)
adds shared encoding and adaptive presentation, changes the comparison defaults
to 4/8/16 players, and saves the exact source at this earlier milestone for
reproduction. The results below remain the historical first comparison.

The useful immediate changes are a shared spatial candidate index for snapshot
replication and direct connection-to-player lookup. Both fit the existing game
model. This investigation also adds repeatable production CPU comparisons up to
the current 40-connection admission limit.

The requested `rc/2.0.0` branch was cloned and pinned to
[`d78047ca62bf801af58e48f4b0ebb15065612d88`](https://github.com/timetocode/nengi/tree/d78047ca62bf801af58e48f4b0ebb15065612d88),
whose package version is `2.0.0-rc.127`. Cached GitHub pages still showed RC.126;
the checked-out source and docs were used. The repository inventory contains
27 AI guide files, 134 implementation/performance/helper TypeScript files, and
56 TypeScript test files. Review covered the guide topics and source API/test
inventory, with detailed tracing of visibility, snapshot preparation and commit,
binary fragments, connection lifecycle, client state, prediction, interpolation,
and performance harnesses. The game baseline is
`eab957a6907f6da1cad0726d6db68fc4e3501459`.

Nengi's capacity comes from reducing work for a particular workload: selecting
visible cells, sharing prepared/encoded updates across subscribers, and allowing
explicit mutation logs where the game can maintain them correctly. Its
[benchmark guide](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/benchmarking.md)
and [performance harness](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/performance/README.md)
distinguish snapshot throughput from a game running physics, transport, and
clients. The default 4,096-connection ceiling is an admission setting, not a
measured capacity guarantee. Our connection limit remains 40.

| Technique                                               | Fit for this game                                                                                                                                                | Decision                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Spatial cells for replication                           | Previously every receiver scanned every active entity, even across distant regions.                                                                              | Implemented a shared batch index.                                                                                 |
| Connection-owned identity and prompt cleanup            | Every input and snapshot receipt scanned the retained player map, including disconnected players kept for 30 minutes.                                            | Implemented a socket index and explicit takeover cleanup.                                                         |
| Share entity preparation across recipients              | Already present in `ReplicationRecords`, persistent entity records, and independent receiver revision cursors.                                                   | Preserve it.                                                                                                      |
| Reuse encoded fragments                                 | Potentially valuable when many players observe the same moving ships.                                                                                            | Next profiling candidate; receiver baselines and snapshot skips must be part of its cache key.                    |
| Manual mutation logs / grouped updates                  | Movement is centralized in some paths, but health, modules, cargo, procedural geometry, and collision effects mutate through several paths.                      | Defer until a complete mutation contract exists.                                                                  |
| Schema-driven binary packets                            | Could reduce snapshot bytes and repeated JSON serialization.                                                                                                     | Requires a measured codec experiment, precision checks, client decode benchmarks, and a compatibility handshake.  |
| Separate raw authority, prediction, and presentation    | Already present in `NetworkClient`, `PredictionManager`, and `RemoteMotion`.                                                                                     | Preserve the separation and shared fixed-step physics.                                                            |
| Adaptive arrival buffering                              | Current remote motion uses four poses and the observed snapshot interval. Nengi adds bounded playback-rate correction and a longer jitter window.                | Useful future visual experiment under seeded jitter; it changes latency and contact presentation.                 |
| Selective historical geometry and public path smoothing | Nengi can retain only the hitboxes needed for rewind and optionally smooth command-driven public movement. Our collision physics advances on shared fixed steps. | Defer; rewind fairness and a second public body would change gameplay semantics.                                  |
| Scoped inventory channels                               | Nearby craft currently include their cargo records in replication.                                                                                               | Consider separating public craft state from owner/docked inventory after defining what other players may inspect. |
| Monotonic deadlines and protocol fingerprints           | Server tick scheduling is monotonic, while some idle/rate-limit bookkeeping uses wall-clock time; production protocol names depend on the build.                 | Good follow-ups for clock changes and mixed deployment detection.                                                 |

The spatial implementation follows the general approach in
[`SpatialGrid.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/server/channel/SpatialGrid.ts)
and [`Channel2D.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/server/channel/Channel2D.ts).
One `ReplicationView` belongs to a completed simulation batch. It lazily buckets
ordinary entities into 2,500-unit cells and retains the sparse station list for
its larger marker range. Each query visits nearby cells, then the existing
snapshot code applies exact circular distances and per-receiver hysteresis.
Candidates retain world insertion order, so packet order and receiver behavior
remain identical. Dense queries fall back to the world scan before sorting.
Sessions with fewer than eight connected players or 256 active entities retain
the original scan. These thresholds keep small sessions off the indexing path;
they are pragmatic workload guards, not universal crossover constants.

Nengi deliberately uses coarse whole-cell visibility in its spatial channels.
We keep exact 2,000/2,500-unit entity and 10,000/11,000-unit station entry/exit
radii. Copying whole-cell visibility would change which state clients receive.
A batch-scoped index also avoids adding movement writers throughout our
simulation. Rebuilding after simulation observes arbitrary movement, deletion,
ID replacement, and region loading. Immediate docking/respawn snapshots continue
to use fresh scans. The index builds only after the existing send/backpressure
checks allow a snapshot, and skipped sends retain their old replication baseline.

Connection lookup now uses `playersBySocket`. Closing or replacing a socket
removes its entry before callbacks can run. A delayed close or message from a
replaced socket cannot affect the replacement connection. The reconnect-token
map continues to own retained player state. Nengi uses connection-associated
`User` objects and performs logical cleanup before transport close callbacks;
see [`InstanceNetwork.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/server/InstanceNetwork.ts).

For a later serialization experiment, the relevant source is
[`sharedEntityFragments.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/binary/snapshot/sharedEntityFragments.ts)
and [`cellFragmentBuilders.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/binary/snapshot/cellFragmentBuilders.ts).
These encode shared changes once and copy fragments into receiver snapshots.
Our existing cache shares extraction/diff work, but `JSON.stringify` still runs
per recipient. Different replication tiers and skipped sends mean recipients can
have different prior revisions. A future cache must distinguish those baselines,
full creates, clears, and object replacement. Start by measuring repeated JSON
encoding separately from extraction before committing to a binary protocol.

[Manual mutation guidance](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/manual-mutations.md)
requires every networked mutation to notify its writer. Losing one uncommon
module or cargo mutation would be a desynchronization bug. Our existing record
comparison catches in-place edits and optional-field clears. Retain that
correctness until profiling justifies the additional mutation responsibility.
Likewise, a switch to nengi's command-duration movement example would need a new
physics replay contract: its
[movement guide](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/realtime-movement-prediction.md)
explicitly distinguishes that model from shared fixed-step physics.

The useful client ideas are selective history sampling and bounded forward
playback correction from
[`EntityHistory.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/client/EntityHistory.ts),
[`InterpolationDelayPolicy.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/client/InterpolationDelayPolicy.ts),
and [`PlaybackCursor.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/client/PlaybackCursor.ts).
They do not remove the need to reconcile against raw state. Our client already
merges every received delta before coalescing pending entity state and acknowledges
receipt independently of rendering. Nengi's ordered frame rule remains relevant
if we later add transient messages or per-frame lifecycle effects: those cannot
be discarded merely because a newer position arrived.

For future lag compensation, the [historian guide](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/historian-lag-compensation.md)
separates historical existence, current existence, and whether a late action
should count. Its grid-assisted nearest-frame queries can preserve exact
results, but the rewind window remains a server policy. A client-reported view
time is a claim to validate, and half of round-trip latency is only an estimate
of one-way delay. This is relevant to future weapons or mining interactions,
not a reason to rewind every static asteroid each tick.

For operational follow-ups, review
[timing and liveness](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/timing-and-liveness.md),
[network limits](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/network-limits.md),
and [operations](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/docs/ai/operations.md).
The game already has payload/message limits, a hello deadline, native heartbeat,
input validation, reconnect backoff, and bounded outstanding snapshots. Nengi
also budgets aggregate retained input/response bytes and separates received input
from completed input. Its native-adapter choices cannot predict our CPU savings
without a real transport benchmark. No transport or protocol replacement was
needed for the implemented changes.

The new benchmark comparison uses the real production property rewrite,
minification, simulation, snapshot construction, and JSON serialization. Each
invocation runs a complete untimed warm cycle, then 300 warm-up ticks and 1,800
measured 30 Hz ticks. Variants run sequentially, alternating order over three
repeats, with the same 16 MiB V8 semi-space. Total process user + system CPU is
normalized per simulation tick. The acceptance check uses the median per
scenario and rejects an increase above 10%. It also requires identical packet
hashes, byte counts, packet counts, entity counts, and final positions across
all repeats and both variants.

Measured on Intel(R) Core(TM) Ultra X7 358H, Node v26.5.0, Linux, without CPU affinity.
All 78 production runs passed the packet/state checks. Every workload median
passed the 10% CPU gate; the largest increase was 2.48% (eight-player spread).
These are comparisons on this host, not absolute comparisons with the older
Ryzen benchmarks in this repository. Full samples and routing measurements are
[saved with the benchmark results](../benchmarking/results/2026-09-27-nengi-networking.json).

| Players | Route   | Before CPU ms/tick | After CPU ms/tick | Change |
| ------- | ------- | -----------------: | ----------------: | -----: |
| 1       | convoy  |             0.1873 |            0.1867 | -0.36% |
| 1       | spread  |             0.1958 |            0.1940 | -0.92% |
| 1       | contact |             0.2238 |            0.2232 | -0.25% |
| 3       | convoy  |             0.3492 |            0.3503 | +0.30% |
| 3       | spread  |             0.5379 |            0.5437 | +1.08% |
| 3       | contact |             0.4593 |            0.4566 | -0.57% |
| 8       | convoy  |             0.8105 |            0.8264 | +1.97% |
| 8       | spread  |             1.5627 |            1.6014 | +2.48% |
| 8       | contact |             0.8966 |            0.9094 | +1.43% |
| 40      | convoy  |             5.4910 |            5.2597 | -4.21% |
| 40      | spread  |            14.0173 |           12.7799 | -8.83% |
| 40      | contact |             5.0528 |            4.8731 | -3.56% |
| 20      | spread  |             5.1392 |            4.9699 | -3.29% |

There is a memory tradeoff to monitor: median process peak RSS in the
40-player convoy runs rose from 322.6 to 385.0 MiB (+19.3%). Eight-player spread
rose from 290.5 to 318.0 MiB (+9.5%); 40-player spread was 778.2 to 782.3 MiB
(+0.5%). The index allocates temporary cells/candidate lists each batch. RSS
also depends on V8 collection timing and includes the complete warm cycle.
A separate one-pair diagnostic forcing GC at the final memory reads measured
87.8 MiB of heap before and 58.2 MiB after, with identical packets. That does
not establish a long-running memory bound or rule out every retention issue;
the peak RSS increase remains a capacity consideration. The saved results
include the diagnostic preload and Node flags, and exclude its timings from
the CPU acceptance table.

The separate source-only routing microbenchmark exercises `GameSession.receive`
with real player records and snapshot acknowledgement messages. It uses 40 active
sockets plus 0, 400, or 4,000 synthetic disconnected identities in the reconnect
map. Each case warms 50,000 receives and measures five blocks of 300,000 receives.
This isolates routing CPU; it excludes parsing, transport, simulation, and client
work. Repeated acknowledgements do not mutate the pending window during timing;
a subsequent assertion checks that a valid acknowledgement still frees it.

| Retained disconnected identities | Before CPU ns/receive | After CPU ns/receive |  Change |
| -------------------------------: | --------------------: | -------------------: | ------: |
|                                0 |                  88.3 |                 22.5 | -74.55% |
|                              400 |                 963.5 |                  9.8 | -98.98% |
|                             4000 |                9541.3 |                 20.6 | -99.78% |

Small absolute timings are noisy. The useful result is that lookup no longer
scales with the retained reconnect map; these percentages are not whole-server
speedups.

These full-session replays use socket stubs that serialize and hash every packet.
They exclude WebSocket/TLS/kernel costs, browser decoding/rendering, and real
network delays. The tests establish local CPU comparisons and identical emitted
state, not a production CCU guarantee. The networking source change is confined
to the server. Existing real WebSocket tests cover the protocol boundary, and
the current 40-client admission cap has not been raised.

Validation includes the production build before and after, typecheck, lint,
simulation/snapshot tests, server and lag tests, reconnect, prediction, and
production packet tests, plus docked UI/lazy-chunk and property-mangling tests.
The new networking test compares indexed snapshots
against full scans through boundary crossings, skipped sends, optional-field
clears, deletion/recreation, same-tick mutations, missing ships, dense cells,
and non-finite/extreme positions. It also covers both synchronous and delayed
old-socket close handling during session takeover.

Changed-file formatting and the formatting rule tests pass. The repository-wide
format check still flags two unchanged baseline files:
`benchmarking/session-tick.mjs` and
`benchmarking/results/2026-09-27-numeric-representations.json`.

Production resource sizes in bytes (gzip level 1, matching the build budget):

| Resource     | Before raw | After raw | Change | Before gzip | After gzip | Change |
| ------------ | ---------: | --------: | -----: | ----------: | ---------: | -----: |
| HTML         |       3986 |      3986 |      0 |        1951 |       1952 |     +1 |
| Client entry |      97133 |     97133 |      0 |       43157 |      43129 |    -28 |
| Docked chunk |       4740 |      4740 |      0 |        2445 |       2445 |      0 |
| Sound chunk  |       1681 |      1681 |      0 |         942 |        942 |      0 |
| Server       |      81813 |     82654 |   +841 |       35390 |      35753 |   +363 |

The baseline sizes come from an isolated build of the baseline commit with the
same installed dependencies. Client byte differences come from the shared
production name mapping; no client source or loading trigger changed. The
existing client-entry 14 KB gzip-budget warning remains. No dependency was added.

Reproduce from the repository root, retaining the baseline commit above:

```sh
mkdir -p /tmp/unicorn-network-baseline
git show eab957a6907f6da1cad0726d6db68fc4e3501459:src/server/game-session.ts > /tmp/unicorn-network-baseline/game-session.ts
git show eab957a6907f6da1cad0726d6db68fc4e3501459:src/server/replication.ts > /tmp/unicorn-network-baseline/replication.ts
node benchmarking/production-flight.mjs --network-baseline=/tmp/unicorn-network-baseline --save=/tmp/network-before.mjs --ticks=30 --scenario=spread
node benchmarking/production-flight.mjs --save=/tmp/network-after.mjs --ticks=30 --scenario=spread
node benchmarking/compare-networking.mjs --before=/tmp/network-before.mjs --after=/tmp/network-after.mjs --output=/tmp/networking-results.json
node benchmarking/network-routing.mjs --network-baseline=/tmp/unicorn-network-baseline
node benchmarking/network-routing.mjs
```

The short compilation runs only freeze bundles. The comparison command selects
the actual measured workload. The source overlay affects the two networking
files during compilation; it does not edit workspace source. Both bundles use
the current production property-name mapping, so their packet hashes can be
compared directly. Run all CPU workloads sequentially with builds and other
CPU-heavy checks stopped. The larger routes extend the existing three anchors:
spread-out groups use 14,000-unit spacing and crowded groups use 350-unit spacing.
