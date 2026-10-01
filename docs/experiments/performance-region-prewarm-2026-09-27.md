# Pre-generating a 50,000-unit world area — 27 September 2026

Pre-generating descriptions and dormant game objects works. Preparing collision
shapes or whole bodies also works without adding dormant objects to the active
simulation. Memory is a usable tradeoff, including with a future 1 GiB machine.
However, in the repeated three-player tests, descriptions alone gave the lowest
average CPU. Bigger caches made first-time activation cheaper, but did not provide
an additional sustained CPU win over descriptions alone.

This records the original benchmark-only prototype and investigation.
The subsequent production implementation is documented in
[the dormant-world follow-up](performance-dormant-world-2026-09-27.md).
The prototype itself changes neither server
startup nor `fly.toml`. The previous collision optimization remains untouched.
There is no world export, upload, or off-server generation pipeline.

## Area, construction and memory

Seed 25, all 2,000-unit regions with positive-area intersection with the circle
of radius 50,000 around the origin:

- 2,040 regions;
- 12,727 asteroids, 19 stations and 27 wrecks;
- 233,966 asteroid/craft segments after constructing all objects.

Whole intersecting regions are included, so a few objects lie outside the circle.
To guarantee cache coverage when a player approaches its edge, production would
also need a halo for detail queries and the larger station visibility/physics
range. The prototype retains fallback on-demand generation outside its coverage.

On the local Node.js 26.8.2 machine, description generation took approximately
0.5 seconds and constructing all objects another 1.1–1.2 seconds. These are local
preparation times, not Fly startup predictions, and exclude the explicit GC used
to measure retained memory. Startup work is excluded from the flight CPU table.

| Preparation level                     | Approximate retained JS heap | Representative idle RSS |
| ------------------------------------- | ---------------------------: | ----------------------: |
| Descriptions                          |                    17–19 MiB |             120–129 MiB |
| All game objects                      |                  178–181 MiB |             293–300 MiB |
| Objects and hitboxes                  |                      200 MiB |                 317 MiB |
| Full original physics bodies/proxies  |                      538 MiB |                 664 MiB |
| Asteroids and compact prepared shapes |                      336 MiB |                 469 MiB |
| Asteroids and compact detached bodies |                      411 MiB |                 546 MiB |

These are process totals, not incremental cache sizes. Each child starts in a
fresh process, with compilation in its parent. Baseline heap is roughly 5–7 MiB.
RSS includes heap capacity, code and native memory. For comparison, a 25,000-unit
circle contains 540 regions and 3,430 objects; fully constructed objects used
about 57 MiB retained heap and 147 MiB RSS.

## Avoiding ongoing dormant-world work

The prototype keeps prepared instances in an ID-keyed map, separate from
`world.entities`, the existing sleeping registry, and active physics lists.
Region queries continue to select only nearby descriptions. Materialization uses
an indexed lookup, and replication still sees only the active world. The largest
active entity count in the repeated flight routes is 209, despite retaining over
12,000 prepared asteroids.

Empty-world ticks verify that dormant objects do not move. Lifecycle checks also
count the live physics bodies and require that they match active entities, rather
than the prepared pool. This eliminates simulation scans of dormant objects;
it does not make a large JS heap free for the garbage collector to maintain.

The current sleeping-object map is scanned every regional sync. Putting every
prepared object there would introduce a new whole-world loop, so the experiment
uses a separate pool instead.

## Collision preparation and memory reductions

Two deeper prototypes were tested:

1. Retain immutable polygon shapes, mass/inertia data and the geometry signature;
   create only bodies, fixtures and spatial proxies on activation.
2. Retain complete detached bodies and fixtures; attach them to the current
   physics world and create spatial proxies on activation.

The second version restores fixture-list membership and registers proxies in
original fixture order. A prepared body is consumed once, so it cannot belong to
two collision worlds or be reused across incompatible prediction timelines.

Memory reductions share repeated immutable vertex and normal vectors within each
asteroid while preserving exact floating-point values, including signed zero.
Rounded geometry signatures are regenerated lazily only if a later mutation
requires the comparison path. Shape-only caches also omit redundant per-fixture
wrappers. No coordinates, collision margins, solver precision or intervals change.

Sharing vectors and removing redundant data reduced the shape-cache prototype
from about 407 to 336 MiB retained heap. Its first spread flight used about
478 MiB RSS; repeated settled runs used 491–505 MiB. Detached-body runs used
558–634 MiB RSS. These memory costs are not rejected merely for exceeding the
current 512 MiB VM; the question is whether their extra preparation pays back
in lower CPU or better arrival latency.

## First-time activation

Three observer positions move apart in 300-unit steps out to radius 45,000.
These are direct streaming queries, not ship flight. Each sync is followed by
an actual collision step with `dt=0` to materialize/check its fixtures. All modes
match the active entity/geometry digest at every sampled route position as an
aggregate hash. The first four rows average three fresh-process runs.

| Preparation                               | Region sync mean | Region sync p95 | Physics preparation/check mean |
| ----------------------------------------- | ---------------: | --------------: | -----------------------------: |
| On demand                                 |         1.895 ms |        4.948 ms |                       0.719 ms |
| Descriptions                              |         0.808 ms |        1.877 ms |                       0.550 ms |
| Objects                                   |         0.148 ms |        0.269 ms |                       0.629 ms |
| Objects and hitboxes                      |         0.148 ms |        0.273 ms |                       0.626 ms |
| Compact shapes + deletion index, one run  |         0.176 ms |        0.326 ms |                       0.526 ms |
| Detached bodies + deletion index, one run |         0.176 ms |        0.325 ms |                       0.564 ms |

Prebuilt objects remove about 92% of the isolated region-sync cost. They do not
remove all first-visit work: broad-phase registration, contact discovery and
snapshot preparation remain. Physics preparation had occasional multi-millisecond
outliers in every version; this does not establish that all lag spikes disappear.

The earlier estimate that generation was around 1.2% of foreground processing
was an average over normal flight. This table deliberately concentrates on
first-time region entry and also includes object construction, explaining the
larger percentage reduction in this narrower phase.

## Real three-player flight

Actual `GameSession` ticks, thrust/steering, shared simulation and serialized
snapshots run for 3,600 measured ticks after 300 warm-up ticks. Each process also
has a separate 3,600-tick empty-world dormancy check. Every child has a 290-second
wall timeout. No test simulates more than five minutes of ticks.

For each route, variants run serially in forward then reverse order, with two
runs per variant. CPU affinity is CPUs 2 and 3. All use a 16 MiB semi-space.
The settled comparison pauses for one second before flight setup and again after
flight warm-up, allowing pending startup GC/compilation work to settle. These are
local scheduling pauses, not a simulation of Fly credit recovery.

| Route             |      On demand |         Descriptions | Compact shapes | Detached bodies |
| ----------------- | -------------: | -------------------: | -------------: | --------------: |
| Separated players | 0.9708 ms/tick |  0.9345 (3.7% lower) |  0.9395 (3.2%) |   0.9464 (2.5%) |
| Convoy            | 0.7386 ms/tick | 0.6567 (11.1% lower) |  0.6856 (7.2%) |   0.6821 (7.6%) |
| Asteroid contacts | 0.8321 ms/tick | 0.7270 (12.6% lower) |  0.7889 (5.2%) |   0.7968 (4.2%) |

The table measures total process CPU, including background V8 work and snapshot
serialization. Socket stubs exclude real transport/TLS. It uses a source bundle,
not the production property-mangled build; these percentages are not deployment
capacity estimates. The larger cache versions include indexed deletion; the
on-demand and description controls retain the current removal implementation.
Two repeats expose large differences but do not establish small differences as
statistically significant. No particular GC mechanism was isolated as the cause
of the larger caches' higher cost relative to descriptions alone.

All 24 runs match their route's recorded snapshot hash, byte/packet counts,
positions, active entity count and maximum active entity count. Asteroids are
consumed from the pristine pool on first activation. Stations/wrecks remain
on-demand in this comparison, retaining runtime cargo/module ID allocation.

This prototype preserves current revisit behavior: a previously activated
asteroid that unloads can be reconstructed on return. Persisting _all_ mutable
objects forever would be a separate lifecycle change, not an assumed benefit
of these measurements.

## Mining, pickup and indexed deletion

The existing shared region manager deletes an ID by filtering every loaded and
saved description. Preloading thousands of descriptions makes that work much
larger. The prototype indexes IDs to their owning descriptions and edits only
that region, while retaining the removed-ID tombstone for station markers.

With a full prewarm, a 25-removal diagnostic measured median removal cost around
0.626 ms without the index versus 0.0014–0.0016 ms with it. These are removal-method
measurements, not the total cost of a mining event.

Lifecycle assertions pass for both prepared-shape and detached-body caches:

- activation actually uses the prepared shape/body;
- dormant bodies are absent from the active solver;
- material changes remain live;
- mass changes and replacement geometry rebuild fixtures correctly;
- mining removes the original parent and creates fragments;
- destroying a resource-bearing fragment produces an item;
- continuous collision through an open cargo hatch collects that item;
- leaving and returning preserves surviving fragment identity and does not
  recreate the parent, destroyed fragment or collected item;
- removing a marker-only station still prevents its return after its region loads.

Runtime fragments still use the existing sleeping registry. A very large
accumulated fragment population could justify spatially indexing that registry
as well; the prepared pool does not add thousands of pristine bodies to it.

## Recommended next implementation

Pre-generate and retain the central descriptions, with indexed removal. That is
the strongest measured average-CPU option and has a small memory footprint.
A prepared-asteroid or compact-shape pool is a reasonable additional latency
tradeoff if first-visit spikes remain important. Memory is not the blocker;
full detached bodies have not shown enough additional benefit to justify their
extra world-transfer machinery over the simpler shape cache.

Preparation can run in-process before gameplay starts, with progress/readiness
reporting. A production implementation should add coverage halos, retain
on-demand fallback, and define whether unloaded mutable asteroid state is reset
or preserved. Preconstructing wrecks needs deliberate runtime ID allocation;
their cargo constructors currently consume IDs during creation. A cache used by
the production server also needs the minified-build and target-heap comparison
before enabling it by default.

This follows the same broad pre-generation idea as
[Chunky](https://github.com/pop4959/Chunky). The prototype keeps its data in memory
and recreates it after restart. It does not generate/upload a world file elsewhere.

## Reproduction and validation

See [benchmark instructions](../../benchmarking/README.md) and
[per-run results](../../benchmarking/results/2026-09-27-region-prewarm.json).
The final script checks its forwarding of an optional old-space limit and reports
the actual V8 heap limit. Early attempts that failed to forward that flag are
excluded from the bounded-heap results.

Verified `--max-old-space-size=512` capacity checks completed for all four modes
with identical spread-route snapshot hashes. The actual total V8 heap limit was
560 MiB; total process RSS was about 148 MiB for cold, 165 MiB for descriptions,
479 MiB for compact shapes and 562 MiB for detached bodies. These single runs
confirm feasibility under a bounded heap, not a repeated performance ranking.
An old-space limit is not a total-process memory limit: these results do not
establish safe operation on a 512 MiB VM. They fit the proposed 1 GiB budget
locally, with production headroom still to verify.

The benchmark's source transforms are explicit experimental hooks, not production
APIs. Compilation occurs in the parent process; each measured child imports only
the resulting source bundle. Forced GC is used between diagnostic stages to
report retained memory, never inside measured flight ticks.

Lint and the lifecycle/replay assertions pass. The production build is unchanged:
main client 95,070 bytes / 42,285 gzip-level-1 bytes; server 78,428 / 34,025 bytes.
The existing main-chunk size warning remains.
