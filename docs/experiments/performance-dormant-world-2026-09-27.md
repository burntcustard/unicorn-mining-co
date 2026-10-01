# Description pre-generation and collision experiments — 27 September 2026

**Current decision: keep description pre-generation; remove the untouched-asteroid
collision flags.** The isolation follow-up below found no consistent benefit
that justified their extra code. Earlier collision-cache optimizations are retained.

The production server now retains region descriptions intersecting a circle of
radius 50,000 around the origin. `preGeneratedRadius` in
[`src/shared/settings.ts`](../../src/shared/settings.ts) controls the radius; zero
turns off startup preparation. Whole intersecting regions are included. Queries
near the edge can still generate neighbouring regions on demand.

For seed 25 this prepares 2,040 regions containing 12,727 asteroids, 19 stations
and 27 wrecks. It does not construct their game objects or physics bodies, add
them to the active simulation, or replicate them to players. Activation and
visibility retain their existing ranges. Preparation happens during server
construction, before listening; there is no external generation/upload pipeline
or deployment configuration change.

## Removal and production generation

Description IDs now index their owning descriptions. Mining/removal filters only
those regions instead of scanning the entire saved world. The index accommodates
multiple descriptions with the same ID. Removal tombstones also apply to later
generation, including a station first discovered through marker-only queries.
Repeated preparation preserves loaded regions and edits to saved descriptions.

Production testing exposed an existing cache-eviction bug: the source called
`candidateRegions.keys().next()`, but the game's property rewrite renamed the
native iterator's `next` method. This path starts executing after 1,024 candidate
regions. A `for...of` eviction avoids that native-property collision. A minified
startup regression test now crosses the threshold and checks return visits.

## Untouched collision experiment (subsequently removed)

`createPolygon` varies radial points inward only. Asteroid segments are formed
from points inside that same circle. Generation already rejects pairs closer than
the sum of their full radii plus 30 units, including candidates across region
boundaries. That gap comfortably covers the 1e-8 coordinate quantization. There
was no need to alter the asteroid layout or increase its spacing.

The tests check pair clearance throughout the pre-generated area and verify the
actual outer and segment vertices of every generated asteroid stay within its
radius, allowing 1e-7 for rounding.

Only the server's procedural loader certifies an asteroid. The certificate
retains its original position and immutable geometry source outside serialized
and cloned entity state. Arbitrary asteroids, fragments and client-created
objects do not receive it. A physical body's eligibility is established when
its fixtures are built, rather than rechecking the certificate every tick.

The contact factory skips two eligible bodies. Rotation and segment health
changes preserve eligibility. Translation, nonzero linear motion or replacing/
removing geometry restore ordinary collision handling. The body also invalidates
it during physics integration, so an impact within the current step is covered.
Invalidation re-queues every fixture even if it stayed inside its old fat bounds;
otherwise a previously skipped pair could be missed. Ships, stations, items and
fragments continue through the existing collision system.

Certification is applied after the normal first body transform. Fixture creation
and contact ordering remain unchanged; initial placement must not invalidate a
new certificate. A trial that initialized the body before creating its fixtures
changed the convoy replay and was also rejected.

## Iterations

The comparison included:

1. A contact-factory filter, with eligibility checked every tick.
2. Earlier rejection of whole asteroid groups in the spatial grid.
3. Rotation-wide cached bounds to avoid updating spinning fixtures.
4. One neighbour query per untouched body, avoiding repeated empty segment queries.
5. Certification during geometry construction, with movement/geometry invalidation.

The rotation-wide bounds were rejected: they increased CPU cost and changed
replay trajectories. Whole-group rejection and the extra body query did not give
consistent CPU savings across routes. Those added spatial-grid mechanisms were
removed. The initially retained version combined the small contact-factory check with
certification at geometry construction. A preliminary certification variant
failed its initialization assertion and is excluded from performance claims.

The existing broad phase already rejects most untouched asteroid pairs cheaply.
Skipping them is therefore a small optimization in these flight routes, not a
large replacement for collision processing. The measurements below distinguish
description preparation from the additional collision work.

## Three-player production measurements

| Route   | Before (CPU ms/tick) | Descriptions only |  Final | Final vs before |
| ------- | -------------------: | ----------------: | -----: | --------------: |
| spread  |               0.8196 |            0.8040 | 0.8023 |      2.1% lower |
| convoy  |               0.5912 |            0.6027 | 0.5980 |     1.1% higher |
| contact |               0.6658 |            0.6457 | 0.6508 |      2.3% lower |

Final process RSS ranged from 233 to 253 MiB. All 27 final runs passed the replay comparisons.
The extra collision filter changes these route means by approximately 0.8% lower
to 0.8% higher relative to descriptions alone, within the variation between runs. It is not
evidence of a substantial collision CPU saving. Description preparation mainly
moves first-visit generation work into startup; the convoy route did not show an
average-CPU improvement over baseline in this production comparison.

Each result comes from a production-minified local Node.js 26.8.2 bundle, with
three players and a 16 MiB semi-space. Each invocation selects one route, runs
one unreported warm-up session, then reports 3,600 ticks after 300 settling ticks
in a fresh session. That is 260 simulated seconds total; each child has a
290-second wall timeout. No test lasts more than five minutes.

Final comparisons alternate three implementation orders, with three repetitions
per implementation and route, pinned to CPUs 2 and 3. CPU includes packet encoding,
background GC and the harness's snapshot hashing; it excludes initial preparation
and actual socket/TLS transport. RSS is total process memory, not cache size.
These are local results, not predictions of Fly shared-CPU utilization.

The final comparison requires identical snapshot hashes, bytes, packet counts,
player positions and active/max entity counts for every implementation on each
route. Earlier experiments are retained separately in the raw results, including
the rejected rotation-wide bounds.

## Isolation follow-up and current decision

The earlier **1.1% convoy increase was for both features together**. In that
batch, descriptions alone were 1.9% above baseline. Those small differences
were not reliable evidence that either feature caused a regression.

A further 36 production-minified runs compared all four combinations, with three
repeats per route and alternating implementation order. CPU milliseconds per tick:

| Route   | Baseline | Descriptions only | Collision skipping only |   Both |
| ------- | -------: | ----------------: | ----------------------: | -----: |
| spread  |   0.8143 |            0.7851 |                  0.8312 | 0.8063 |
| convoy  |   0.6000 |            0.5954 |                  0.5940 | 0.5965 |
| contact |   0.6780 |            0.6544 |                  0.6644 | 0.6562 |

Descriptions alone reduced the route means by 3.6% (spread), 0.8% (convoy) and
3.5% (contact), relative to baseline in this batch. Collision-only was 0.24%
faster than descriptions on convoy, but slower on spread and contact. That tiny
convoy difference is within run-to-run variation. Descriptions-only had the lowest
overall mean and avoids the extra collision flags, certification and invalidation
machinery. It is now the retained implementation. The cache-eviction fix, indexed
removal and generation-spacing checks are retained as well.

All 36 runs matched snapshot hashes, packet bytes/counts, player positions and
active/max entity counts. Each test remained below five minutes. The restored
collision code preserves the earlier geometry/motion-cache optimizations; only
the latest untouched-asteroid experiment and its dedicated tests were removed.
The initial combined-build measurements below are historical, not current build sizes.

## Validation (initial combined implementation)

The full `npm test` suite passes, including server integration, reconnect,
production packets, shared prediction, collisions and property mangling.
Additional cases cover dormant descriptions, on-demand fallback, removal across
unload/reload, intact geometry, spin, segment loss, fragments, movement inside fat
bounds, within-step impacts and ordinary objects touching rotating asteroids.

The final production build passes. Client main: 95,667 bytes raw / 42,533 gzip-level-1
(previously 95,070 / 42,285). Server: 79,538 / 34,467
(previously 78,428 / 34,025). The existing main-chunk size warning remains.
Lint and whitespace checks pass.

A separate spread-route capacity check used `--max-old-space-size=256` and
verified an actual total V8 heap limit of 304 MiB. It completed with the same
snapshot hash and approximately 158 MiB process RSS. This is a local short-run
capacity check, not a deployment memory guarantee. The benchmark argument parser
now preserves embedded equals signs in Node flags.

The source-bundled startup diagnostic prepared the descriptions in approximately
502 ms wall time / 656 ms CPU, with 21.3 MiB retained JS heap and 126 MiB process
RSS afterward. Those are total memory values after diagnostic GC, not incremental
cache size or Fly startup predictions. No game objects were constructed.

[Raw results](../../benchmarking/results/2026-09-27-dormant-world.json) and
[benchmark commands](../../benchmarking/README.md) accompany this report.

## Validation after removing collision skipping

Production build, region tests, collision tests, server integration, production
property-mangling regressions and lint pass. Current main client: 95,070 bytes raw / 42,291 gzip-level-1; server: 78,934 / 34,205.
