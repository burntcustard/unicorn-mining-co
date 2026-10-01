# Server Set iteration experiments — 2026-09-27

These experiments keep the Sets as the stored collections. They only convert to
temporary arrays at selected server iteration sites, following the client
parent-linking microbenchmark. No stored Set was replaced by an array.

The retained change is a single temporary conversion in
`SpatialGrid.query`: iterate `[...group.nodes]` when rebuilding a body's bounds.
The fixture collection remains a Set. The confirmation comparison measured
**3.0% less total server CPU**, or **16.2 microseconds per tick** averaged across
three-player routes. No client-only code changed.

## Scope and method

Baseline: `0c3c8c1f9b5e9c8ed133315d38057581a110c2d8`.
Use the production flight replay on Node 26.8.2 with a 16 MiB semi-space and CPU
affinity 2,3. Each candidate was tested independently against the same baseline
on the spread, convoy and contact routes, with three players and three alternating
repetitions per variant and route. No concurrent benchmarks or builds ran.

Each child runs two 3,900-tick sessions (300 warm-up + 3,600 measured ticks),
260 simulated seconds in total, with a 290-second wall timeout. The first cycle
warms V8 and caches. CPU measurements include allocation/GC and background V8
work; socket stubs retain real JSON serialization but exclude transport/TLS.
These are local whole-session CPU comparisons, not measured Fly reductions.

## Results

Positive values mean less CPU; negative values mean more CPU. Aggregate saving
uses the sum of the three route medians. The last column is the difference
between the equally weighted average route medians, in microseconds per tick.

| Temporary conversion                      | Spread | Convoy | Contact | Aggregate | µs saved/tick |
| ----------------------------------------- | -----: | -----: | ------: | --------: | ------------: |
| Region unloading: spread, filter, forEach | -4.75% | +1.05% |  -1.28% |    -1.98% |         -9.66 |
| Dirty grid groups: spread, forEach        | -4.60% | +1.05% |  -0.19% |    -1.59% |         -8.10 |
| Fixture passes: spread before iteration   | +3.77% | +8.66% |  +0.63% |    +4.20% |        +22.88 |
| Fixture selection: spread, filter, append | +4.99% | +3.28% |  -0.46% |    +2.78% |        +15.21 |

All measured variants produced identical packet hashes, bytes, entity counts and
final player positions. The 1% aggregate acceptance threshold from the earlier
investigation still applies; tiny apparent gains do not justify keeping changes.

## Confirmation and retained change

The strongest initial candidate converted fixture Sets in both bounds rebuilding
and collision-candidate iteration. A fresh, balanced-order three-way comparison
then tested baseline, both conversions, and bounds rebuilding alone. Each variant
occupied each run-order position once, on every route. Three repetitions per
variant and route; medians in process CPU milliseconds per tick:

| Route   | Baseline | Bounds conversion only | Reduction |
| ------- | -------: | ---------------------: | --------: |
| Spread  |   0.6608 |                 0.6243 |     5.53% |
| Convoy  |   0.4479 |                 0.4424 |     1.23% |
| Contact |   0.5155 |                 0.5090 |     1.27% |

Bounds conversion alone saved 2.99% overall.
The extra plain candidate-loop conversion saved only
0.97% on top, below the cutoff, so it was removed.
A final incremental test of the _filtered_ candidate loop on top of bounds
conversion changed CPU by +1.83% (positive means more CPU), so that
alternative was also removed. Its initially positive standalone result is not
an additional saving that can be added to the retained change.

The final production edit preserves the authoritative Sets, uniqueness,
iteration order and membership operations. The array is temporary and contains
references to the same fixtures. Builds and other heavy checks were stopped
during timing; desktop activity and V8 variation still make these estimates,
not statistical confidence bounds or a promised Fly improvement.

## Other Sets reviewed

- Collision retained IDs, replication visibility IDs and grid query deduplication
  are primarily used for membership checks. They retain direct Set lookups.
- Replication already converts visible IDs into an array when a membership packet
  needs one.
- Procedural description-owner Sets are traversed on removals, not as a normal
  flying workload hot path.
- WebSocket clients are traversed for a heartbeat once every 30 seconds or during
  shutdown; this is not a per-update optimization opportunity.
- Entity-state/rollback Sets are client prediction work and were excluded.

The client result does not imply that adding an array conversion helps other
loops. Benefits have to exceed the copy/filter allocations and survive timing
of the whole server workload.

[Raw comparisons](../../benchmarking/results/2026-09-27-set-iteration.json) preserve
all individual runs. Reproduce with saved baseline/candidate bundles using the
commands under “Production flight replay” in [the benchmark guide](../../benchmarking/README.md),
with `--ticks=3600 --warm --semi-space=16` and one route per invocation.

## Validation and build sizes

`npm run build` (including typecheck), `npm run test:collisions`, and
`npm run lint` pass. Collision tests include exhaustive grid-query comparisons
across movement, removal and cell changes, deliberately colliding cell hashes,
fixture changes, contact response and continuous collision detection.
All flight comparison hashes and outcomes match. No new simulation behavior or
protocol fields were introduced.

| Resource    | Raw bytes before → after | gzip level 1 bytes before → after |
| ----------- | -----------------------: | --------------------------------: |
| docked      |            4,740 → 4,740 |                     2,446 → 2,445 |
| Main client |          96,677 → 96,682 |                   42,957 → 42,956 |
| server.js   |          81,205 → 81,210 |                   35,015 → 35,018 |
| sound       |            1,681 → 1,681 |                         942 → 942 |
