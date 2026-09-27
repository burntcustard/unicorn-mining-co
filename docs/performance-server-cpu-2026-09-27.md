# Server CPU follow-up — 2026-09-27

The retained patch reduces measured three-player process CPU by **28.8%**
across the three equally long routes. **The requested 50% reduction was not
achieved.** These are local production-build replays, not a measured Fly reduction.
No deployment, VM configuration, simulation frequency or V8 deployment flags changed.

## Complete patch against deployed baseline

Baseline: `f10887123b6acdd0f7613028cdfce43db69c57bb`, including the 50,000-radius
description cache and the previously deployed collision optimizations.
Five alternating repetitions per variant and route; medians in CPU milliseconds
per simulation tick:

| Three-player route | Baseline | Retained patch | Reduction |
| ------------------ | -------: | -------------: | --------: |
| Spread             |   0.7901 |         0.5800 |     26.6% |
| Convoy             |   0.5972 |         0.4103 |     31.3% |
| Contact            |   0.6524 |         0.4625 |     29.1% |

The combined reduction is `1 - sum(after medians) / sum(before medians)`, not
an addition of incremental percentages. All retained final runs have identical
packet hashes, byte counts, entity counts and final player positions to baseline.
A separate receiver oracle also reconstructed identical client state after
11,703 snapshots per route (35,109 total), with zero differing deltas.

## Method and limits

- Node 26.8.2, Ryzen 7 5800X3D, process affinity CPUs 2 and 3,
  `--max-semi-space-size=16` for both implementations.
- Real production property rewriting and final Terser compression. Three players
  hold thrust with occasional steering; only starting placements are assigned.
- Each invocation runs two sessions of 300 warm-up + 3,600 measured ticks;
  the first complete cycle warms V8 and caches. Total simulated duration is
  260 seconds, and every child has a 290-second wall timeout.
- Process user + system CPU includes background V8 work. Comparisons run serially
  without builds or other benchmarks in parallel. Socket stubs serialize and hash
  real packets, but omit transport/TLS, client rendering and VM contention.
- Each idea was compared separately with the preceding retained bundle. The
  acceptance criterion is more than 1% saving in the sum of route medians. Small
  individual-route regressions are visible in the raw results; they are not hidden
  by claiming every individual experiment improved every route.
- Five-run medians reduce noise but are not confidence intervals. Local CPU time
  does not establish the number of Fly players sustainable within its allowance.

The live machine's read-only `/proc/cpuinfo` reports AMD family 23/model 49,
a generic EPYC model string and 512 KiB cache entries. That does not identify its
host L3 allocation or establish equivalent performance to this desktop.

## Retained changes and incremental acceptance

| Change                                                           | Aggregate saving in its own A/B test |
| ---------------------------------------------------------------- | -----------------------------------: |
| Direct mount/module collection without flatMap intermediates     |                                3.31% |
| Direct replication field reads instead of reader closures        |                                3.75% |
| Single snapshot visibility/preparation/output traversal          |                                2.29% |
| Guarded craft geometry tokens and reusable drill colliders       |                                1.66% |
| Uniform craft segment property layout                            |                                1.55% |
| Find the engine without constructing a module array              |                                1.76% |
| Cache flattened regional description candidates                  |                                3.42% |
| Share immutable fixed craft collision outlines                   |                                1.56% |
| Keep previous poses beside physics body records                  |                                1.73% |
| Reuse the latest changed-field list for current observers        |                                1.41% |
| Initialize common optional movement fields together              |                                5.13% |
| Initialize remaining common optional replication fields together |                                8.56% |
| Hoist replication field updater out of per-entity extraction     |                                2.17% |

Replication now reads fields directly, shares one updater, and visits visible
entities once per observer. The record keeps its latest changes so an up-to-date
observer avoids scanning the whole field history; observers that missed updates
still use the complete revision history. Optional-field clearing, object replacement,
cargo contents and all wire keys retain their existing behavior.

Common optional entity fields and runtime craft segments have consistent property
layouts. This reduces varied field lookup paths rather than introducing a separate
server-only simulation. Craft mount/module/engine queries avoid intermediate arrays.

Craft hitboxes already visit changing geometry, so that pass now produces a token
that permits fixture reuse without a second full geometry scan. Fixed model vertices
share cached relative outlines; numeric vertices are immutable, while edge markings
remain mutable. Animated/replaced geometry, docking, physics toggles, membership,
mass, inertia and custom margins retain invalidation paths. Mutable custom outlines
still use the checked path. Starting poses now live beside body records, removing
an additional map and cleanup pass. Regional queries retain flattened candidates
until their region rectangles or loaded descriptions change.

## Rejected experiments

The raw data includes every repeated comparison, including superseded prototypes.
Examples rejected for regression, less than 1% aggregate saving, or an unfair
behavioral comparison:

- Scalar equality fast paths, typed numeric update helpers, revision bitmasks,
  and parallel arrays for replication fields.
- Lazy full replication-record materialization, stable record slots, combined
  observer membership/history, and visibility-distance reuse.
- Sorted Float64 body bounds, retaining sorted bounds across ticks, grid-neighborhood
  caches, and alternative local-coordinate geometry signatures.
- Freezing asteroid segment membership arrays (distinct from immutable vertices):
  regressed all three routes substantially.
- A module-state single-pass prototype and an undamaged-craft early scan. The latter
  saved about 0.7% overall, below the cutoff.
- Avoiding a duplicate motion-bound calculation: slower overall. Comparing small
  primitive arrays instead of JSON serialization: also slower overall.
- Wider collision proxy margins and dormant asteroid proxies: altered collision
  ordering and later flight paths. Their timings cannot establish a gain for the
  same workload, so neither is retained.
- Larger inlining budgets, disabling Maglev, and additional optional structure fields:
  no dependable qualifying aggregate gain.

An early test of `--max-valid-polymorphic-map-count=16` helped an intermediate
bundle. Repeating the comparison after source layout fixes removed that benefit;
16, 32 and 64 all regressed the aggregate versus the default of 4. **No additional
V8 flags are retained.** This prevents counting two fixes for the same bottleneck.

## Cache locality and memory

The suggested [JavaScript optimization article](https://romgrk.com/posts/optimizing-javascript)
was used to identify experiments. V8's own [property-layout explanation](https://v8.dev/blog/fast-properties)
and [array element-kind documentation](https://v8.dev/blog/elements-kinds)
explain why consistent shapes and ordinary packed arrays can outperform more
elaborate representations. The measured layout changes helped; the typed-array and
frozen-membership experiments did not. We cannot pin JavaScript data into L1/L2/L3,
and no hardware cache-miss measurement was made, so this report does not attribute
the gains to a measured cache-hit improvement.

Median peak process RSS, MiB (includes initialization and both warm cycles):

| Route   | Baseline | Retained patch |
| ------- | -------: | -------------: |
| Spread  |    248.8 |          254.8 |
| Convoy  |    246.3 |          252.8 |
| Contact |    236.3 |          256.4 |

Additional retained memory goes to field-change references, consistent optional
slots and immutable outline/candidate caches. Pre-generated descriptions remain
inactive. No giant active-world or per-tick packed-world copy was introduced.

## Validation and build cost

`npm test` and `npm run lint` pass. The test suite includes the production build,
real socket integration, reconnect, packet sizes, shared simulation/prediction,
collision response, damage/repairs, and separately built lazy chunks. Added collision
regressions cover cached craft fixtures, live material changes, mutable geometry
replacement, local offsets, margins, docking and physics toggles.

An initial production audit caught the newly introduced cache property `outline`
remaining unmangled. Renaming it to the existing `shapeOutline` terminology fixed
that failure before the successful full run. Changed files pass formatting;
repository-wide `format:check` still reports the unchanged `benchmarking/session-tick.mjs`.

Resource bytes, raw and gzip level 1:

| Resource    | Raw bytes before → after | gzip-1 bytes before → after |
| ----------- | -----------------------: | --------------------------: |
| docked      |            4,740 → 4,740 |               2,446 → 2,446 |
| Main client |          95,085 → 96,668 |             42,302 → 42,952 |
| server.js   |          78,943 → 81,205 |             34,210 → 35,015 |
| sound       |            1,681 → 1,681 |                   942 → 942 |

## Remaining foreground work

A fresh exclusive-timer profile of the final patch, averaged across the three
three-player routes, gives the following hotspot estimates. These timers add
overhead, especially for per-entity methods; they are **not process CPU shares**
and are separate from the uninstrumented acceptance measurements above.

| Category                               | Instrumented ms/tick | Share of instrumented foreground time |
| -------------------------------------- | -------------------: | ------------------------------------: |
| Collision and physics                  |               0.2338 |                                 43.0% |
| Snapshot extraction and deltas         |               0.1299 |                                 23.9% |
| Entity movement and module updates     |               0.0876 |                                 16.1% |
| Region queries and lifecycle           |               0.0416 |                                  7.7% |
| World bookkeeping and contact gameplay |               0.0263 |                                  4.8% |
| Packet JSON encoding                   |               0.0153 |                                  2.8% |

The remainder is session/input work and benchmark hashing/wire construction.
Physics and replication remain the largest areas. Region generation is not the
dominant sustained cost within the pre-generated area, and encoding packets is
a small part of the measured workload. Physics bounds/contact maintenance is a
better next target than speculative changes to vector types or CPU flags.

## Reproduction and remaining target

```sh
# Save each source state separately, using the same installed dependencies:
node benchmarking/production-flight.mjs --scenario=spread --ticks=3600 --warm --semi-space=16 --save=/tmp/before.mjs
node benchmarking/production-flight.mjs --scenario=spread --ticks=3600 --warm --semi-space=16 --save=/tmp/after.mjs
# Alternate these sequentially; repeat for convoy and contact, five times:
taskset -c 2,3 node benchmarking/production-flight.mjs --bundle=/tmp/before.mjs --scenario=spread --ticks=3600 --warm --semi-space=16
taskset -c 2,3 node benchmarking/production-flight.mjs --bundle=/tmp/after.mjs --scenario=spread --ticks=3600 --warm --semi-space=16
```

[Machine-readable measurements](../benchmarking/results/2026-09-27-server-cpu.json)
contain the individual runs, incremental decisions, flag retests and resource sizes.
The retained patch is useful but leaves the requested 50% target unmet. Further
work should be based on a fresh profile of this patch; changing collision ordering
requires a controlled workload and collision correctness checks before accepting
CPU comparisons. The current results are not evidence that a further reduction is
impossible, nor a guarantee that Fly throttling will disappear after deployment.
