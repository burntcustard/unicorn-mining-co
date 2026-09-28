# Server CPU at 4, 8 and 16 players — 2026-09-28

**Selected patch:** reuse the world's entity ID map for collision cleanup, use a
scalar replication updater, and take a direct synchronization path for ordinary
asteroids. The three changes each saved more than 1% process CPU when measured
separately at **four players**, the priority workload. Their separate eight- and
sixteen-player results were mixed. Together they reduced CPU in the final
comparisons at all three player counts. Positive percentages below mean less CPU
than baseline commit `61dca01978f39ae04efb74eaa92c925bc91afd86`.

The collision step's input was simplified after this measured patch; see the
[one-input follow-up](performance-collision-one-input-2026-09-28.md).

These are local production-bundle replays. They are not measurements on the Fly
VM or a guarantee of additional server capacity.

## What changed

1. [`GameCollisions.step`](../src/shared/collision/game-collisions.ts) uses the
   authoritative `world.entities` map to decide which physics bodies to remove.
   [`updateWorld`](../src/shared/simulation/update-world.ts) passes that map.
   In this measured patch, direct callers without a map retained the original
   `Set` path. Normal world insertion and restoration key the map by `entity.id`.
2. [Replication](../src/server/replication.ts) updates primitive fields with a
   dedicated scalar path. It checks stable values before the generic array and
   vector handling, while retaining revision updates, deletion of absent fields
   and normalization of nonfinite numbers to `null`.
3. Collision synchronization checks the cached geometry token directly for an
   ordinary asteroid using the built-in hitbox. Changes to mass, inertia or
   geometry and custom hitboxes still take the detailed synchronization path.

## Combined CPU results

Each route has 1,800 measured simulation ticks. The **route-median** aggregate
sums the four route median CPU milliseconds per tick and compares that sum with
the baseline. The **paired** aggregate takes the median saving across repeats,
with each repeat summing all four routes. Both are shown because their ordering
can differ under run-to-run variation. The four-player matrix used eight
repeats; the eight- and sixteen-player matrix used five.

| Players | Convoy | Spread | Contact | Modules | Route-median aggregate | Paired aggregate | Baseline → selected CPU ms/tick sum |
| ------: | -----: | -----: | ------: | ------: | ---------------------: | ---------------: | ----------------------------------: |
|   **4** | +6.87% | +3.84% |  +4.78% |  +2.21% |             **+4.39%** |       **+3.27%** |                     4.7574 → 4.5488 |
|       8 | +0.54% | +5.89% |  +3.60% |  +2.06% |             **+3.44%** |       **+2.61%** |                   11.9197 → 11.5095 |
|      16 | +1.94% | +5.48% |  +5.96% |  +0.10% |             **+3.49%** |       **+4.51%** |                   23.9572 → 23.1218 |

The paired aggregate was positive in every repeat of these final combined
matrices: +1.32% to +9.38% at four players, +0.02% to +5.17% at eight, and
+2.34% to +6.19% at sixteen. The nearly flat sixteen-player modules route and
the small eight-player convoy gain remain practical limits of this evidence.
The complete runs are in the [four-player confirmation](../benchmarking/results/2026-09-28-cpu-4-final-choice.json)
and [eight- and sixteen-player matrix](../benchmarking/results/2026-09-28-cpu-8-16-final.json).

## One change at a time

The four-player membership and scalar figures come from one eight-repeat matrix;
the asteroid figures come from another eight-repeat matrix with its own baseline.
The eight- and sixteen-player figures come from the same five-repeat matrix as
the selected combination above. Route columns and the route-median aggregate
show percentage CPU savings. The paired column is the median saving in each
repeat's four-route sum.

| Players | Change                      | Convoy | Spread | Contact | Modules | Route-median aggregate | Paired aggregate |
| ------: | --------------------------- | -----: | -----: | ------: | ------: | ---------------------: | ---------------: |
|   **4** | World-map collision cleanup | +2.86% | +1.44% |  +3.21% |  −2.60% |             **+1.24%** |       **+2.18%** |
|   **4** | Scalar replication updater  | +2.40% | +2.88% |  +1.82% |  +0.36% |             **+1.91%** |       **+1.76%** |
|   **4** | Native asteroid sync path   | +0.74% | +0.05% |  +3.83% |  +2.38% |             **+1.71%** |       **+2.10%** |
|       8 | World-map collision cleanup | −1.90% | +4.85% |  −1.41% |  +0.77% |                 +1.41% |           +0.04% |
|       8 | Scalar replication updater  | −1.49% | +0.67% |  −0.96% |  +0.04% |                 −0.14% |           −1.58% |
|       8 | Native asteroid sync path   | +1.44% | +1.69% |  +2.83% |  +0.93% |                 +1.60% |           +1.03% |
|      16 | World-map collision cleanup | +6.62% | +3.71% |  +1.80% |  −3.40% |                 +2.00% |           +0.82% |
|      16 | Scalar replication updater  | +1.24% | +0.79% |  +3.55% |  −2.46% |                 +0.60% |           +0.05% |
|      16 | Native asteroid sync path   | +0.36% | +0.34% |  +1.39% |  −5.39% |                 −0.94% |           +0.30% |

Thus all three **individually** clear 1% at the prioritized four-player count;
the measurements do **not** show that each clears 1% at eight and sixteen
players. The all-count CPU benefit belongs to the combined patch. Individual
savings cannot simply be added: changes can affect the same hot path, JIT
choices, allocation and measurement noise. The raw [four-player scalar and
membership runs](../benchmarking/results/2026-09-28-cpu-4-new-validations.json),
[four-player asteroid runs](../benchmarking/results/2026-09-28-cpu-4-combined.json),
and [larger-player runs](../benchmarking/results/2026-09-28-cpu-8-16-final.json)
retain every replay.

## Four-player selection and memory

Two further matrices compared combinations directly. The earlier patch combined
packed polygon bounds, a scalar guard and asteroid sync. A geometry-loop
alternative cleared 1% on its own at four players but combined poorly with
membership and the scalar updater; its [head-to-head runs](../benchmarking/results/2026-09-28-cpu-4-combinations.json)
record the interaction. Replacing that loop with the asteroid sync path produced
the selected lower-memory patch.

| Four-player matrix                                                                      | Selected route-median / paired | Earlier packed patch route-median / paired |
| --------------------------------------------------------------------------------------- | -----------------------------: | -----------------------------------------: |
| Five-repeat [ablation](../benchmarking/results/2026-09-28-cpu-4-ablation.json)          |                +4.13% / +5.10% |                            +3.94% / +4.38% |
| Eight-repeat [confirmation](../benchmarking/results/2026-09-28-cpu-4-final-choice.json) |                +4.39% / +3.27% |                            +3.65% / +4.24% |

The confirmation favors the selected patch by route medians and the earlier
packed patch by the paired median. Both reduced CPU. The selected patch also
avoids the packed polygon coordinate cache and showed lower peak RSS in these
replays. A separate packed-bounds plus asteroid plus scalar ablation is retained
in the [raw ablation file](../benchmarking/results/2026-09-28-cpu-4-ablation.json).

Median **peak process RSS** in MiB, baseline → selected, includes startup,
warm-up and measured replay:

| Players |        Convoy |        Spread |       Contact |       Modules |
| ------: | ------------: | ------------: | ------------: | ------------: |
|   **4** | 230.0 → 226.4 | 249.3 → 237.0 | 231.5 → 229.8 | 230.2 → 229.6 |
|       8 | 232.0 → 231.8 | 315.9 → 290.6 | 243.4 → 232.7 | 275.4 → 271.4 |
|      16 | 302.3 → 296.0 | 465.5 → 397.5 | 302.0 → 292.3 | 310.6 → 285.6 |

The sixteen-player spread median is 68.0 MiB lower in this matrix. Peak RSS
varies with garbage collection and startup allocation, so these medians do not
isolate the memory cost of any one source change or establish a VM memory limit.

## Method and behavior checks

Node v26.5.0 with V8 14.6.202.34-node.24 ran on an Intel Core Ultra X7 358H,
pinned to logical CPU 12. Each child used `--max-semi-space-size=16`. The
[comparison runner](../benchmarking/compare-cpu.mjs) executed one process at a
time and rotated variant order. Every production bundle had the real property
rewrite and two final Terser compression passes. Each route received one
untimed complete cycle, then a fresh session with 300 warm-up ticks and 1,800
measured ticks at 30 Hz. Convoy, spread, contact and module-toggle routes use
the same deterministic inputs for every variant.

The runner required identical outgoing packet hashes, packet and byte counts,
final player positions, final entity counts and peak entity counts before
accepting a CPU comparison. `cpuMs` uses process user plus system CPU time; the
[Node process API](https://nodejs.org/api/process.html#processcpuusagepreviousvalue)
returns those values in microseconds. It includes V8 and garbage collection
work but excludes live TLS/socket transport, browser rendering and Fly VM
contention. Repeat ranges show variability, not confidence intervals. The
[benchmark guide](../benchmarking/README.md) gives reproduction commands and
explains the saved bundle format.

The main worktree passed `npm test` (including its production build),
`npm run lint`, the changed-file `oxfmt --check` and `git diff --check`.
Focused tests cover removed and replaced collision entities, asteroid mass,
inertia and custom-hitbox invalidation, and replication of nonfinite and absent
scalar fields. A final four-player one-tick production smoke replay matched the
expected packet hash, byte count and positions. The main and measured isolated
source trees and emitted `dist/server.js` are byte-identical. Their saved replay
files differ only in the absolute path of the imported `ws` wrapper; after
normalizing that dependency path, the bundles are byte-identical.

## Node 26 and V8 research

The [Node 26 release](https://nodejs.org/en/blog/release/v26.0.0) identifies
V8 14.6 as its JavaScript engine. We used V8's notes on
[fast properties](https://v8.dev/blog/fast-properties) and
[array element kinds](https://v8.dev/blog/elements-kinds) to examine stable
object shapes and dense numeric-array experiments. These describe plausible
engine behavior; the whole-server replays above decide whether a candidate
actually helps this workload. Short Node 26 `--trace-deopt` runs found warm-up
wrong-map events, but no sustained deoptimization pattern explaining the
measured gains.

V8 documents a faster plain-data
[`JSON.stringify`](https://v8.dev/blog/json-stringify) path introduced in V8
13.8. The server already reuses entity fragments through `SnapshotEncoder`;
JSON and snapshot experiments that did not meet the CPU threshold were left
out. The selected patch uses no new V8 runtime flag.

## Frozen artifacts and build size

The hashes identify the **isolated source-set bundles used in the final CPU
matrices**, not arbitrary later build paths. The final worktree equivalence
check is described above.

| Bundle                     | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| Baseline                   | `686c43b56067e5a2ab19a98b513309fb1a7ec84a1c316cb298e53f755f7ed395` |
| World-map cleanup          | `4c0fc036f5b9542ecd64aece045590e7c49eb16d607f1e75423d4df8c00be37d` |
| Scalar replication updater | `6ab27d32c71dd2a0ae74c0d2e52499a4a47467e068d8518ea66700d53ff97c3e` |
| Native asteroid sync       | `7c54cbbe83ca34dc92816cbefbf5520260f3e62b749f87bc26ec7e405010fe1a` |
| Selected combination       | `abe573bc467af376f4610c8b6601a1cacce310f76a2b42130305ce04af74c010` |

Production assets, raw bytes and gzip level 1, baseline → selected:

| Resource    |             Raw |          gzip-1 |
| ----------- | --------------: | --------------: |
| Main client | 97,463 → 97,556 | 44,218 → 44,250 |
| `server.js` | 83,374 → 83,649 | 36,836 → 36,851 |
