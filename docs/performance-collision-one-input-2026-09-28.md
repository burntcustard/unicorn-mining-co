# One-input collision step — 2026-09-28

This follow-up revisits the collision API in the [original CPU patch](performance-cpu-players-2026-09-28.md) and the [five-proposal investigation](performance-cpu-followup-2026-09-28.md). Positive percentages mean less process CPU than the optimized two-input baseline. Four players remain the priority workload.

## Decision

`GameCollisions.step` now takes one ID-keyed entity map. It takes a fresh values snapshot inside the step, removes stale physics bodies by checking the same map, and then synchronizes the snapshot. The separate `entitiesById` argument and retained-ID `Set` fallback are gone.

This is primarily an API and code simplification. The repeated four-player result is effectively flat: the pooled median paired saving across two independent sessions is +0.11% (7 of 11 paired repeats positive). The eight-player matrix saved +0.56% by route medians and +1.06% paired. The sixteen-player matrix gave −0.35% and +0.74%, respectively. Those differences do not establish a reliable server CPU saving from this API change, but they are consistent with roughly equal CPU use.

`GameObject` already has an `id`. The simulation world already stores entities in a `Map` keyed by that ID, and insertion/restoration use the same key. Creating another ID field or changing world storage would duplicate existing data. A snapshot is still required: hitbox callbacks can add entities during synchronization, and a live map iterator would visit them in the same step.

## Alternatives measured

All candidates kept the same gameplay and exact outgoing packet hashes, bytes, packet counts, final positions, and entity counts in the production replay. The first four-player matrix included a compatibility version that accepts maps or arrays, a strict map-only version, and an array-only version that marks body records by generation. The second four-player matrix retested the strict map and array-only versions independently.

| Candidate                    | 4 players, first 5 × 5,000 ticks | 4 players, confirm 6 × 5,000 ticks |
| ---------------------------- | -------------------------------: | ---------------------------------: |
| Map with array compatibility |     +1.53% route / +1.60% paired |                                  — |
| Strict map only, selected    |                  +1.81% / +0.94% |                    −0.30% / −0.22% |
| Array with generation marks  |                  +2.19% / +1.41% |                    +0.46% / +0.36% |

The [first four-player matrix](../benchmarking/results/2026-09-28-collision-one-input-4.json) and [independent confirmation](../benchmarking/results/2026-09-28-collision-one-input-4-confirm.json) retain every run. Pooled paired medians are +0.11% for strict map and +0.80% for array generation marks. The corresponding means are +0.23% and +0.61%. Baseline samples varied enough that the sub-one-point gap is not a dependable gain.

| Players | Strict map, route / paired | Array generation, route / paired |
| ------: | -------------------------: | -------------------------------: |
|       8 |            +0.56% / +1.06% |                  +0.92% / +0.97% |
|      16 |            −0.35% / +0.74% |                  +0.97% / +1.22% |

The [eight- and sixteen-player matrix](../benchmarking/results/2026-09-28-collision-one-input-8-16.json) used five repeats of 1,800 ticks per route. It includes convoy, spread, contact, and modules at both player counts.

Sixteen-player contact looked unfavorable to strict map in that matrix: −3.35% route / −4.27% paired, with all five paired repeats slower. A separate [eight-repeat contact comparison](../benchmarking/results/2026-09-28-collision-one-input-16-contact-confirm.json) reversed that result: strict map saved +1.74% route / +0.73% paired; the compatibility map saved +1.83% / +1.95%. Across both sessions, strict map's 13 paired contact repeats have a median of −0.21%. The conflict prevents treating the first contact result as a reproducible regression or the second as a proven gain.

A previous map-only experiment copied values into a reused array by hand and measured −0.78% route / −0.08% paired at four players. The selected version uses `[...entities.values()]` instead. [V8 documents a fast path for spreading map values](https://v8.dev/blog/spread-elements); that is a plausible explanation for the difference, though these full-server measurements do not isolate the spread operation.

The array generation version was modestly faster overall, but it swept stale bodies **after** syncing new fixtures. The current code sweeps them **before** sync. A targeted simultaneous remove/add test matched ordered contacts and resolved motion, yet an instrumented hitbox could observe the stale body during array-version sync. The ordering can also affect physics proxy creation during churn. Moving generation marking before sync would restore the order but add a lookup pass and more record state. The strict map keeps the existing order with less code.

## Method and validation

Node v26.5.0 with V8 14.6.202.34-node.24 ran on logical CPU 12. The [comparison runner](../benchmarking/compare-cpu.mjs) rotated variant order, launched one production-bundle replay at a time, warmed each process, and checked exact packet and final-state parity before reporting CPU. The four-player matrices used 5,000 measured ticks on all four routes; the eight- and sixteen-player matrix used 1,800. Process CPU includes user, system, V8, and GC work. These local replays exclude live transport and Fly VM contention. Repeat ranges show variation, not confidence intervals.

The strict-map candidate passed focused removal, same-ID replacement, and hitbox-addition tests in isolation. The final worktree passed `npm test`, `npm run build`, and `npm run lint`. The selected frozen production replay bundle is 81,245 bytes raw / 35,174 bytes gzip level 1, compared with 81,418 / 35,217 for the two-input baseline. The final built `dist/server.js` is 83,497 / 36,086 bytes; the main client bundle is 97,404 / 43,329 bytes, raw / gzip level 1.
