# Three-player CPU investigation — 26 September 2026

This follows the first deployment of the collision-signature and idle-timeout
fixes, with two shared Fly CPUs and 512 MB. The live game still stalls while
browser animation continues. Further avoidable work was found in collision
preparation, broadphase updates, replication and procedural regions.

## Baseline and method

Fly reported deployed commit `80c0253b210be21d7a7817cfcfd08a1d4c8ea9ca`,
shared × 2, 512 MB, LHR. The checkout started at
`6183f4e3ab93be20e02ddee428237977badd7c42`; its only difference from that
release was `docs/todo.md`. The baseline therefore includes the earlier fixes.
No deployment or VM resource change was made during this investigation.

`benchmarking/three-player-flight.mjs` runs three simultaneous players with
held thrust and periodic steering. It assigns starting positions once, then
uses normal inputs and simulation. There is no mining. The three routes start
as a convoy, with separated players, and in an asteroid contact area; impacts
and fractures can happen naturally. Entity counts and outgoing traffic are
checked rather than assuming every route has an identical workload.

Each route has 300 warm-up ticks followed by 9,000 measured ticks: five simulated
minutes at 30 Hz. Measurement includes region management, input handling,
movement, collisions, replication, JSON encoding and a snapshot hash in each
socket stub. It excludes actual network transport and browser rendering.
`process.cpuUsage()` measures user + system CPU, including V8 background work.
Phase instrumentation was disabled for the final comparisons.

Frozen before/after bundles were run sequentially on this workstation
(AMD Ryzen 7 5800X3D, Node 26.8.2), with browser tests stopped. The result is a
relative CPU comparison, not a prediction of capacity on Fly's host CPU.

## Repeat measurements

CPU milliseconds per tick; baseline is the median of three runs, fixed code
is the mean of two runs. Both measured versions were loaded from frozen bundles
in fresh processes. Even the slowest fixed run versus the fastest baseline run
exceeds 50% reduction in each scenario.

| Three-player route | Before | After | Reduction |
| ------------------ | -----: | ----: | --------: |
| Convoy             |  3.971 | 1.748 |     56.0% |
| Spread             |  3.289 | 1.423 |     56.7% |
| Contact            |  2.899 | 1.221 |     57.9% |

Worst measured tick wall time fell from 21.8–30.2 ms across baseline runs to
6.3–10.6 ms across the final runs. This is a finite sample maximum, not a latency
guarantee. The repeated candidate generation was a significant source of spikes.

Every complete run emits 81,000 measured snapshots across the three routes.
Before and after have identical SHA-256 hashes for all outgoing packets,
identical packet counts, byte counts, final positions and maximum entity counts.
This checks the full sampled timelines, not merely the final state. It is strong
regression evidence for these routes, not a proof for every possible gameplay
state; focused collision, mutation, region and snapshot tests cover other cases.

## Unnecessary work removed

- **Collision geometry:** unchanged asteroid vertices are compared in place.
  The general path reuses numeric scratch storage and constructs transformed
  vertex objects only for changed fixtures. Numeric checks still detect
  in-place edits; the existing geometry quantisation is retained. Segment
  collider objects are reused with refreshed motion/material references. Their
  weak caches live outside entity state so prediction clones stay isolated.
- **Broadphase synchronization:** a conservative body-level movement bound can
  prove that both sweep endpoints still fit all existing padded tree boxes.
  In that case, updating every segment box and checking the tree again cannot
  change the tree. The bound reserves 10% of the available margin, includes
  rotation and translation, and falls back to full synchronization otherwise.
  Only immutable game fixtures opt in, and fixture changes invalidate it.
  Direct physics callers retain the full path for mutable shapes.
- **Bounds calculations:** equal transforms need one shape-bounds calculation,
  not two. Polygon bounds avoid an intermediate vector write for every vertex.
- **Replication:** overlapping player views share one preparation of each
  entity per emission round. Each player retains independent interest and delta
  history. Primitive fields avoid JSON encoding for comparison; intermediate
  spread/filter/map allocations were removed. Immediate same-tick updates get
  fresh preparation rather than a cache that survives a world tick.
- **Region queries:** moving inside the same region rectangles no longer
  reloads/scans the entire region union. Exact distance filtering still runs
  for each position. Asteroid and wreck searches no longer flatten every region
  needed for distant station markers.
- **Procedural generation:** adjacent loads used to regenerate the same nine
  neighboring candidate regions. A bounded 1,024-entry source cache reuses those
  candidates. Returned descriptions are deep copies so gameplay edits cannot
  corrupt another load or world. Seeds form part of the cache key.

The collision solver, movement schedule, snapshot frequency, interest radii and
world population were retained. No distant-object collision culling was added.

## Real browser flights

Three independent clean Chrome profiles ran simultaneously against the live
site for seven minutes, then against the fixed local source game for seven
minutes. Each browser used a 1280×800 headless window, held thrust, and made a
brief steering adjustment every 30 seconds. Counters measured animation-frame
callbacks and WebSocket arrivals in ten-second windows after loading.
Animation-frame frequency is not a GPU rendering benchmark.

Ranges below are per-player ten-second windows from seconds 20–420.

| Test                    | Animation callbacks/s | Server messages/s | Worst message gap |
| ----------------------- | --------------------: | ----------------: | ----------------: |
| Live, deployed baseline |             60.0–60.0 |          5.4–30.9 |          7,487 ms |
| Local, fixed code       |             56.3–60.0 |         29.9–30.2 |            170 ms |

The 7.5-second live gap occurred in the early joining/loading period. After
the first minute, the live test still had gaps up to 1702 ms and late windows
with only about 5–7 updates/s. The local test retained normal cadence through
the five-minute point and to completion, without browser errors. The source
game-server process peaked at 172.2 MiB RSS during this flight, including its
TypeScript runtime; that is distinct from the bundled CPU harness memory figures.

The live clients also recorded authoritative tick progression. Late in the run,
server tick increments matched only about 54–71 snapshots per ten seconds,
rather than 300: this was slowed simulation, not merely a low browser frame
counter. Simultaneous gaps across the three connections support a common
server-side stall. The earlier Fly quota evidence remains relevant, but these
local measurements do not establish that all production throttling is gone.
That requires repeating the live flight after this change is deployed.

## Validation and artifacts

The full `npm test` suite passed, including server networking, collision and
prediction/replay tests. Final property-name changes were followed by another
production build, packet interoperability test and lazy docked-chunk tests.
`npm run lint` passed. New regression tests cover independent player deltas,
immediate same-tick changes, cached-query movement and removals, procedural
mutation isolation, and broadphase equivalence over 4,000 moving/rotating/swept
poses with teleports and added fixtures. Degenerate collider edits preserve
unrelated fixture identity.

The client entry grew from 42,037 to 42,727 gzip-level-1 bytes (+690 bytes,
1.6%). Its uncompressed size grew from 95.65 to 97.10 kB. Sound and docked
chunks remain approximately 1.68 and 4.74 kB uncompressed. The existing entry
chunk warning against the 14 KB target remains; no loading boundary changed.

Raw CPU runs and browser window metrics are in
`benchmarking/results/2026-09-26-three-player-performance.json`. The benchmark
commands and measurement limitations are documented in `benchmarking/README.md`.
All investigation-owned local servers and browsers were stopped afterward.
