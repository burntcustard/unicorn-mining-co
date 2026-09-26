# Performance and simplification follow-up — 26–27 September 2026

This pass starts from the uncommitted implementation measured in
[the preceding investigation](performance-investigation-2026-09-26-three-player.md).
Its goal is another 50% reduction in three-player server CPU while simplifying
production code. The baseline source and executable bundle were frozen before
this pass; comparisons are against that snapshot, not against a moving checkout.

## CPU results

CPU milliseconds per tick. Sustained before/after values are means of two fresh
process runs, each with the full warm-up cycle. The original-version comparison
uses one additional identically warmed run of the pre-investigation bundle.

| Three-player route | Start of this pass | Final | Further reduction | Original version | Total reduction |
| ------------------ | -----------------: | ----: | ----------------: | ---------------: | --------------: |
| Convoy             |              1.571 | 0.768 |             51.1% |            3.594 |           78.6% |
| Spread             |              1.504 | 0.648 |             56.9% |            3.533 |           81.7% |
| Contact            |              1.488 | 0.667 |             55.2% |            3.536 |           81.1% |

Every route clears the additional 50% target even when comparing its slowest
final run against its fastest start-of-pass run (50.4%, 56.7%, and 54.1%).
Aggregated over the three routes, sustained CPU is **54.4% lower in this pass**.
The original-version comparison shows **78.6–81.7% lower CPU** overall.

Fresh-process results are retained rather than hidden by the longer warm-up:

| Route   | Before | Final | Reduction |
| ------- | -----: | ----: | --------: |
| Convoy  |  1.641 | 0.870 |     47.0% |
| Spread  |  1.504 | 0.703 |     53.2% |
| Contact |  1.526 | 0.677 |     55.6% |

The cold convoy result does **not** individually reach 50%; the sustained-server
comparison does. The warm result is the relevant estimate for the reported
slowdown after several minutes, and is not a claim that startup cost disappeared.

All matched runs have identical packet SHA-256 hashes, byte counts, final
positions, and final/maximum entity counts within their warm-up mode. Each full
measured run emits 81,000 packets. Sustained final p95 tick times are about
1.05–1.50 ms; the largest observed final tick is 4.63 ms, versus 6.38–10.30 ms
in the start-of-pass runs and 22.47–23.85 ms in the original-version run.
Sample maxima are not latency guarantees.

Raw runs, hashes, source-size counts and browser summaries are retained in
[`benchmarking/results/2026-09-26-performance-simplification.json`](../benchmarking/results/2026-09-26-performance-simplification.json).
Reproduction commands and options are in [the benchmark README](../benchmarking/README.md).

## What changed

- Replaced the general balanced collision tree with a smaller spatial grid of
  bodies. Fixtures on the same body cannot collide. The grid rejects whole
  distant bodies before testing their fixtures, uses integer bucket keys, and
  retains exact padded-AABB checks. Hash collisions can add candidates but cannot
  introduce or hide contacts. Candidate fixture order is stable.
- Removed the fixture-proxy wrapper and the distance-query proxy layer. Continuous
  collision queries now read circle/polygon shapes directly instead of copying
  their vertices into temporary proxies. Circle center replacement still works.
- Generated and fractured asteroid vertices are explicitly immutable. Their
  derived colliders expose current owner pose and friction through getters.
  Changing health does not rebuild geometry; replacing geometry does. Mutable
  geometry, restored objects, and custom hitboxes retain a checked path.
- Each fixture reuses its padded bounds until conservative body motion exhausts
  its own margin. A body-wide minimum skips even the fixture scan when safe.
  Direct physics users with mutable shapes retain full synchronization.
- Craft hitboxes reuse centered polygon storage, omit disabled shapes for physics,
  and avoid intermediate per-segment arrays. Geometry comparison checks coordinates
  before constructing new fixtures. Unconnected bodies share one solver batch.
- Snapshot comparison keeps scalar/vector values directly and copies mutable
  asteroid segment state, sharing only frozen coordinates. It avoids repeatedly
  serializing that geometry while retaining independent per-player deltas.
- Distant station markers no longer require generating all surrounding asteroid
  regions. Nearby detail generation and loaded/saved station edits are preserved.
  Default single-player detail residency falls from 121 regions to nine.

Several additional cache/dictionary and stationary-motion experiments were
removed because their measurements did not justify retaining more code.
Simulation frequency, movement tiers, replication cadence, gameplay ranges and
Fly resources are unchanged in this pass.

## Comparison method

The harness uses three players holding thrust with occasional steering, without
mining, on convoy, separated-player and asteroid-contact routes. Each route has
300 warm-up ticks and 9,000 measured ticks (five simulated minutes at 30 Hz).
Inputs, region management, movement, collisions, snapshots, JSON encoding and
packet hashing are included. Rendering and real network transport are excluded.
CPU is process user + system time on the same Ryzen 7 5800X3D / Node 26.8.2 host.
Runs are sequential, with browser captures and other test workloads stopped.
These are relative CPU estimates, not predictions of capacity on a Fly host.

A different collision index can change contact ordering, and hence later flight
paths and entity density. Both implementations therefore run with
`--ordered-pairs`, which applies the same candidate ordering before comparing
CPU. Matching packet hashes, byte counts, entity counts and final positions
check that they actually simulate the same workloads. This does not claim that
arbitrary simultaneous contacts retain the old tree's traversal order. The
production grid uses the same stable order without the harness wrapper.

Both fresh-process and sustained-load results are retained. `--warm` runs one
complete untimed cycle before creating new measured sessions. This separates
sustained server work from startup compilation, which was appreciably larger on
the first route. Before and after use identical warm-up rules. Process-wide IDs
advance during warm-up, so compare hashes within a mode rather than across modes.

## Code size and validation

Compared with this pass's source snapshot, production TypeScript is **198 lines
and 3,433 bytes smaller**. Across both optimization passes it is 64 lines larger
than the original checkout. Added regression tests and benchmark documentation
are separate from those production counts.

The initial JavaScript entry is **42,685 gzip-level-1 bytes**, down from 42,727
(-42 bytes), and 96,532 uncompressed bytes (previous build: 97.10 kB). The initial
JS request count remains one. Sound and docked UI remain separate lazy requests,
1,681 / 4,740 raw bytes and 942 / 2,445 gzip-level-1 bytes respectively. No loading
trigger changed. The existing 14 KB entry-budget warning remains.

`npm test` and `npm run lint` pass. This includes the production build, packet
interoperability, prediction/rollback, cargo/shield/drill collision behavior,
server/reconnect tests, and separately emitted lazy UI chunks. New tests cover:

- Random grid queries against exhaustive bounds scans, including owner pruning,
  movement, removal and deliberately colliding integer bucket hashes.
- Cached bounds versus full synchronization through rotations and teleports.
- Immutable geometry, mutable replacements, live collider properties, and
  in-place snapshot damage/cargo/vertex changes.
- Station markers against full legacy regional generation, removal on return,
  and edits retained through loaded/saved region state.

The property-name audit found and fixed an unmangled private outline field;
new private grid/cache names now mangle without adding native API names to the
rewrite list. The production packet and lazy-chunk tests passed afterward.

## Seven-minute browser soak

Three independent headless Chrome profiles flew simultaneously against one fresh
local source server and Vite frontend, using real WebSockets at 1280 × 800. Each
ran for seven minutes; staggered startup still left more than six minutes with
all three connected. Held thrust and periodic steering carried the ships through
different regions. Read-only state checks confirmed all three remained connected,
alive and moving beyond five minutes.

Excluding the initial 20 seconds, mean frame intervals were 16.666–16.670 ms
(about 60 FPS). The largest frame interval was 33.4 ms. Authoritative tick rates
were 30.000, 30.000 and 29.998 Hz; mean snapshot intervals were 33.333 ms and the
largest gap was 64.8 ms. No browser errors or sustained slowdowns were recorded.
The dev server alone averaged 6.0% of one local CPU core over 24 ten-second
samples; that separate observation is not a Fly capacity estimate.

The full CPU comparisons and production builds finished before this capture.
All investigation-owned browser, server and watcher processes were stopped
at completion. Production chunk interoperability was checked by the test suite;
this browser capture uses the matching development frontend/server.

## Deployment status

Read-only Fly status confirms two shared vCPUs and 512 MB in LHR, currently on
commit `6183f4e3ab93be20e02ddee428237977badd7c42`. That commit differs from the
original deployed baseline only in documentation. Neither optimization pass in
this working tree has been deployed by this investigation. The preceding report
contains the three-player live capture; production improvement must be measured
after the user commits and deployment completes.
