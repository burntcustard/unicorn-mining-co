# Monomorphism follow-up — 2026-09-27

No production changes retained. Three isolated experiments failed to establish a
repeatable saving above 1% in the three-player server workload. The closest result
was 0.99% in screening, falling to 0.49% in the longer confirmation run.

## Optional arguments versus actual shapes

The important unit is an individual property access or call site, not a global
"monomorphic mode" for a function or server. TypeScript's `?` disappears during
compilation. A default expression handles `undefined`; it does not inherently
make an access polymorphic. Different supplied keys, property insertion order,
prototypes and field representations can affect shapes.

This distinction follows the original explanation of
[inline caches and specialization](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html)
and V8's [property-layout documentation](https://v8.dev/blog/fast-properties).
The [other requested article](https://romgrk.com/posts/optimizing-javascript)
also recommends measuring production workloads and questioning microbenchmark
results. The 2015 article is useful background, not a precise description of
every optimization in today's Node 26/V8 14.6.

### `ease()`

There is one production caller: the client camera. It always supplies `duration`,
`from` and `to` in that order. The server does not call it. Removing defaults could
narrow its API but cannot reduce server CPU. No camera API change was made and no
client-only speedup is claimed.

### `updateEntities()`

The server's one call site in `updateWorld()` already passes `world`, `inputs`,
`events`, `dt`, `tick` and `inputOffset` consistently. The client also calls it
from prediction catch-up with `world`, `entities` and `tick`, using the defaults.
Client calls execute in a separate process/isolate; they cannot contaminate the
server's inline-cache feedback.

A production-minified, readable spread-flight run with `--log-ic` showed all seven
option loads (`world`, `entities`, `tick`, `inputs`, `events`, `dt`, `inputOffset`)
transitioning to **monomorphic** state and staying there. Even the consistently
missing `entities` key has a monomorphic lookup. Making `dt` required therefore
removes a default check, not an existing polymorphic site. It also requires the
client catch-up caller to pass `simulationStep` explicitly.

The client and shared simulation must continue using the appropriate elapsed
interval; changing API types is not a reason to hard-code arbitrary simulation
deltas. The experiment preserves the supplied delta values.

### Actual varying shapes

The entity-position read inside `updateTier()` was **polymorphic** in that trace.
The option object itself was monomorphic. Passing a position directly moves the
entity lookup to its callers and gives the helper a vector; that is a plausible
specialization but does not eliminate the need to read entity positions. A separate
IC trace of this variant confirmed monomorphic option and observer-position reads
in the helper, but the full flight comparison still regressed.

The `world.entities` read in the default for `updateEntities.entities` also saw
polymorphism. `createWorld()` omits `movementParents`, which is first assigned by
movement scheduling. The world-shape experiment initializes that property to
`undefined` at construction so the scheduler does not add it later. This concerns
initial shape stabilization, not a property being deleted and re-added each tick.

There were also megamorphic accesses in construction/model code and map-related
deoptimizations. Counts in an IC log are **state transitions, not execution counts**.
The trace includes startup and warm-up, so neither those counts nor the total
number of maps seen over time establishes a sustained CPU bottleneck. No native
instruction or hardware-cache speedup is claimed.

Earlier production work already initialized common movement/replication fields
and standardized craft segment layouts; see the
[previous investigation](performance-server-cpu-2026-09-27.md). This pass builds
on those changes rather than measuring an unoptimized version of the game.

## Experiments and results

Each candidate is applied independently to the baseline by a build-time transform
in `benchmarking/shape-experiments.mjs`. Release builds do not load that module.

Screening: three repeats, three routes, baseline plus three candidates = 36 runs.
Each invocation uses a complete warm session followed by a measured session;
each session has 300 warm-up and 1,800 measured logical ticks. All measurements
use Node 26.8.2 / V8 14.6.202.34-node.28 on a Ryzen 7 5800X3D, three players,
16 MiB semi-space and production property mangling/minification. Variants run
sequentially in rotating order, reversed for convoy.

Median process CPU milliseconds per simulation tick:

| Candidate                                       |   Spread |   Convoy |  Contact | Aggregate CPU saving |
| ----------------------------------------------- | -------: | -------: | -------: | -------------------: |
| Baseline                                        | 0.621479 | 0.437484 | 0.534841 |                    — |
| Require `dt`; remove its fallback               | 0.620921 | 0.442181 | 0.517792 |                0.81% |
| Pass position directly to `updateTier()`        | 0.636549 | 0.450608 | 0.523281 |               -1.04% |
| Initialize `movementParents` in `createWorld()` | 0.625204 | 0.424776 | 0.527966 |                0.99% |

Aggregate saving is `1 - sum(candidate route medians) / sum(baseline route medians)`.
Small route-specific differences are visible rather than hidden by the aggregate.

The borderline world-shape result received a separate confirmation: five repeats
per route, 3,600 measured ticks plus 300 warm-up per session, two sessions per
invocation, alternating baseline/candidate order, both pinned to CPUs 2 and 3.
That is another 30 runs. Compare within this stage, not against the shorter,
unpinned screening measurements.

| Candidate                    |   Spread |   Convoy |  Contact | Aggregate CPU saving |
| ---------------------------- | -------: | -------: | -------: | -------------------: |
| Baseline                     | 0.569812 | 0.402385 | 0.456641 |                    — |
| Initialize `movementParents` | 0.561135 | 0.403349 | 0.457355 |                0.49% |

All 66 timed runs match their stage/route's baseline packet hash, bytes, packet
count, final and peak entity counts, and final player positions. These candidates
do not change collision ordering, simulation outcomes or network data in the
measured scenarios. The result is unlike experiments where altered trajectories
make the workload itself cheaper.

The diagnostic trace runs were separate from these timings. Every child has a
290-second wall timeout; the longest workload simulates 260 seconds across its
two sessions, and no individual run took more than five minutes. These are local
CPU comparisons, not measurements of Fly scheduling, network/TLS overhead or
client rendering. Three/five-run medians are not statistical confidence intervals.

## Decision and reproduction

Keep the existing production APIs and object initialization. None of the candidates
has demonstrated the required greater-than-1% saving. In particular, making optional
properties required throughout the codebase would add churn without evidence of a
server benefit. Future shape work should target repeatedly expensive accesses to
heterogeneous entity/fixture data, with an actual profile and a measured reduction
in lookup cost; constructor map transitions alone are insufficient evidence.

The benchmark flags and diagnostic commands are documented in
[`benchmarking/README.md`](../benchmarking/README.md). All 66 comparison runs,
method metadata, relevant baseline IC events and deoptimization counts are in
[`benchmarking/results/2026-09-27-monomorphism.json`](../benchmarking/results/2026-09-27-monomorphism.json).

Production source and configuration are unchanged. The reusable benchmark variants
and this report are the retained result of the investigation.

Validation: `npm run lint`, `npm run build`, formatting checks for changed files,
and `git diff --check` pass. Benchmark correctness comparisons pass as described
above. Production bundle sizes are unchanged: main client 96,988 B / 43,100 B
at gzip level 1; server 81,470 B / 35,202 B; docked 4,740 B / 2,446 B;
sound 1,681 B / 942 B. The full gameplay test suite was not rerun for these
benchmark-only changes.
