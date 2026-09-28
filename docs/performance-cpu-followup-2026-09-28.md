# Server CPU follow-up: five proposed changes

The baseline for this follow-up is the uncommitted three-change CPU patch
described in [the earlier report](performance-cpu-players-2026-09-28.md).
Positive percentages mean less process CPU than that baseline. Four players are
the priority workload; eight and sixteen players remain part of the decision.
The later [one-input collision follow-up](performance-collision-one-input-2026-09-28.md)
revisits a separate API simplification.

## Decision

None of the five proposed changes is retained. The four-player workload is the
priority, but the eight- and sixteen-player measurements also inform the
0.5% cutoff. The original three-change uncommitted patch remains in the main
checkout; this follow-up adds only the benchmark evidence and a short comment
explaining the collision step's two inputs.

- Static segment progress: the initial `WeakMap` version regressed at eight
  players. The simpler instance-owned version narrowly saved 0.63% by route
  medians at four players, but only 0.16% at eight. Its paired results were
  +0.59% and −0.30%, respectively, so it does not meet the cutoff.
- Client drill `biting`: the short four-player screens disagreed; the longer
  route-median aggregate was −0.13%. Its positive eight- and sixteen-player
  screens do not establish the required four-player saving.
- Optional simulation events and removal of unused exterior-edge calls: the
  four-player aggregates were flat or slower.
- Client-only lighting direction: the four-player results disagreed between
  route and paired summaries, and the combined screen was slower.

No earlier optimization was reverted in this experiment: there was no retained
new change for it to interact with. The directly tested map-only collision
simplification used a manually reused snapshot array and was slower at four
players, so the two-input call remained at this stage.

## Isolated production-replay results

Each candidate was applied alone to the same baseline source and built with
the production property rewrite and minification. Four-player measurements used
eight balanced repeats per route; eight and sixteen players used six. Every
repeat measured 1,800 warmed ticks on each of convoy, spread, contact and
modules, with Node 26.5.0, V8 14.6 and logical CPU 12 pinned. The aggregate
compares the sum of route-median CPU milliseconds per tick. The paired column
is the median of each repeat's four-route CPU reduction. These are local
process user plus system CPU measurements, including V8 and GC work.

| Proposal                          | 4 players, route / paired | 8 players, route / paired | 16 players, route / paired |
| --------------------------------- | ------------------------: | ------------------------: | -------------------------: |
| Static segment progress           |           +1.70% / +1.11% |           −0.92% / −1.22% |            +1.09% / +0.37% |
| Client drill `biting` feedback    |           +1.54% / +2.11% |           +0.73% / +1.44% |            +1.83% / +1.98% |
| Optional simulation events        |           −0.32% / −0.64% |           −0.34% / −0.39% |            +1.82% / +1.42% |
| Remove unused exterior-edge calls |           −0.05% / +0.10% |           −0.49% / −0.53% |            +3.01% / +2.43% |
| Client-only lighting direction    |           +0.26% / +0.72% |           +0.01% / +0.92% |            +0.17% / +0.03% |

The lighting result was borderline at four players. A separate eight-repeat,
3,600-tick head-to-head gave +1.50% by route medians but only +0.23% by the
paired median. Its individual benefit is therefore uncertain at the 0.5%
cutoff. The event and exterior-edge proposals did not clear that cutoff at
four players, despite savings in some sixteen-player routes.

The raw results are [four-player convoy](../benchmarking/results/2026-09-28-followup-cpu-4-convoy.json),
[other four-player routes](../benchmarking/results/2026-09-28-followup-cpu-4-rest.json),
[eight and sixteen players](../benchmarking/results/2026-09-28-followup-cpu-8-16.json),
and the [lighting confirmation](../benchmarking/results/2026-09-28-followup-lighting-4-confirm.json).

## Longer four-player confirmation

The [first short combined matrix](../benchmarking/results/2026-09-28-followup-combined-4-screen.json)
contradicted the isolated static and drill results: its four-player route
aggregates were −1.13% for static, −0.91% for drill, −0.39% for both and
−1.38% when lighting was also included. A separate five-repeat matrix then
measured 5,000 warmed ticks on all four routes. It compared the same optimized baseline with drill feedback, an
instance-owned static-segment list, the original static-plus-drill combination,
and a map-only collision API that copies values into a reused snapshot array.

| Candidate                           | Route-median aggregate | Paired aggregate |
| ----------------------------------- | ---------------------: | ---------------: |
| Drill feedback                      |                 −0.13% |           +1.17% |
| Instance-owned static segments      |                 +0.63% |           +0.59% |
| Static segments plus drill feedback |                 −0.30% |           +0.37% |
| Map-only collision API              |                 −0.78% |           −0.08% |

Only the instance-owned static list narrowly cleared 0.5% on both summaries.
The other variants did not establish a four-player gain at that cutoff. The
[complete long-run results](../benchmarking/results/2026-09-28-followup-long-4.json)
include every route and repeat. The original static cache used a `WeakMap`;
the instance-owned alternative avoids that lookup while keeping the same
segment-list invalidation behavior.

The [eight- and sixteen-player confirmation](../benchmarking/results/2026-09-28-followup-owned-static-8-16.json)
for the instance-owned list used five repeats of 1,800 warmed ticks per route,
with exact outgoing packet hashes as well as matching state and byte counts.

| Players | Route-median aggregate | Paired aggregate |
| ------: | ---------------------: | ---------------: |
|       8 |                 +0.16% |           −0.30% |
|      16 |                 +0.84% |           +0.49% |

This alternative avoids the original `WeakMap` lookup but still misses the
0.5% target at eight players. Its four-player result is close enough to the
cutoff that run-to-run variation also limits confidence there.

## Collision input simplification

`GameCollisions.step` currently gets both a snapshot array and the world's ID
map. The snapshot fixes which entities are visited when hitbox callbacks add
entities during a step; the map avoids rebuilding a retained-ID `Set` while
removing stale physics bodies. A map-only version copied map values into a
reused array before synchronization and passed the hitbox-addition regression
test. It preserved the one-tick packet hash but measured −0.78% by route
medians and −0.08% paired at four players, so the two-input API remained for
this experiment. The [later follow-up](performance-collision-one-input-2026-09-28.md)
tests a fresh native spread snapshot and an array-only alternative.

[V8 documents a fast path for `[...map.values()]`](https://v8.dev/blog/spread-elements).
That makes the manual-copy result plausible, though this benchmark does not
isolate V8's implementation from the rest of collision processing.

## Packet and gameplay checks

The production bundles use a shared Terser property-name cache that is seeded
from source files. Some candidate edits shifted the short names used for
packet object keys, so exact packet hashes differed even when packet values
did not. A separate 1,800-tick packet trace compared the four four-player
routes, plus eight-player modules and sixteen-player contact, after a single
consistent one-to-one key remapping. Full recursive comparisons of all 7,200
packets in the four-player convoy and spread traces also matched values,
array order and object field order. Those comparisons used the explicit `--allow-mangled-wire-keys` option;
the runner still required matching packet counts and bytes, final positions,
final entity counts and peak entity counts.
The source changes also passed focused tests in their isolated trees.

The replay uses stub sockets and does not include actual transport, browser
rendering or Fly VM contention. Repeat ranges reflect variability and are not
confidence intervals. CPU reductions here are not measured reductions on Fly.

## Final validation

Each isolated candidate and the tested static-plus-drill combination passed
its build, tests, lint and changed-file formatting in a separate source tree.
The final main checkout passed `npm test`, `npm run build`, `npm run lint`, the
changed-file `oxfmt --check` and `git diff --check`. The final production
`server.js` is 83,649 bytes raw / 36,851 bytes gzip level 1, and the main
client is 97,556 / 44,250 bytes, matching the earlier selected patch because
none of these five source changes was retained.
