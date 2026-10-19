# Collision and HUD performance improvements — October 18, 2026

The later [input/startup follow-up](input-startup-2026-10-18.md) investigates the
input failures recorded here, repairs their measurement, and verifies shared
audio/input and snapshot timing fixes in Chrome and Firefox. The captures below
remain the historical results from before that follow-up.

The working tree now bounds overlap recovery geometrically in both the client
and server, reuses projection storage, and caches the HUD map's CSS size between
resizes. These changes address the hotspots found in the
[three-commit investigation](ui-collision-performance-2026-10-18.md).
They have not been deployed; the completed public live suite still measures
revision `94969b9` without these improvements.

## Recovery results

The comparison below uses unchanged `94969b9` versus the recovery optimization,
not the revision from before the three commits. All 16 cases ran in three
alternating before/after pairs, for **96 captures**, with the original server
fixture, seed 25, 120 warmup ticks, and 1,800 measured ticks. Both executables
used Go 1.27.1, SIMD, the production PGO profile, CPUs 0/1, `GOMAXPROCS=2`,
`GOGC=200`, and no memory limit. No browser captures, builds, or tests competed
with the comparison. Values are medians across three captures.

| Module players | Before CPU ms/tick | Optimized CPU ms/tick | CPU reduction | Before elapsed p95 ms | Optimized elapsed p95 ms | Before allocated B/tick | Optimized allocated B/tick |
| -------------- | ------------------ | --------------------- | ------------- | --------------------- | ------------------------ | ----------------------- | -------------------------- |
| 4              | 0.3995             | 0.1921                | 51.9%         | 1.525                 | 0.460                    | 160,089                 | 51,535                     |
| 8              | 1.3562             | 0.3638                | 73.2%         | 8.069                 | 1.078                    | 621,226                 | 93,498                     |
| 16             | 3.7780             | 0.7733                | 79.5%         | 19.790                | 2.159                    | 1,737,677               | 160,137                    |
| 32             | 17.4439            | 2.5717                | 85.3%         | 104.029               | 9.293                    | 8,451,544               | 471,285                    |

At 32-player modules, allocation fell 94.4% and elapsed p95 fell 91.1%. The
optimized case's p95 fits the 33.33 ms tick budget on this host. This is not a
guarantee for every tick, longer sessions, or the production shared CPUs.

| Other 32-player workloads | Before CPU ms/tick | Optimized CPU ms/tick | Change |
| ------------------------- | ------------------ | --------------------- | ------ |
| Convoy                    | 0.6802             | 0.5450                | −19.9% |
| Spread                    | 0.5074             | 0.5072                | −0.05% |
| Contact                   | 0.3212             | 0.3265                | +1.6%  |

The small spread/contact changes do not establish an improvement. Recovery
was not the principal hotspot in those workloads. Larger active regions and
new gameplay/replication work remain, so the optimized revision is still more
expensive than the revision from before the three commits in several cases.
For example, that older revision's 32-player module result was 1.251 ms CPU/tick,
with different gameplay outcomes and entities.

Unlike the original whole-revision comparison, **every optimized pair passed
strict outcome comparison**: final ship states, contact/event counts, entity
counts, packet counts, and encoded byte totals met the runner's tolerances.
Measured motion differences were zero.
The fixture uses fake sockets and excludes SQLite writes and actual network
transport. It establishes simulation/replication cost and the checked outcomes,
not full production capacity.

## Why the recovery change is safe to prune

The old routine built forbidden-translation slabs for every fixture pair and
searched all those slabs along every escape direction. The optimized routine:

1. Searches the original first ray against every eligible pair. An empty ray
   intersection can stop processing that pair early; such a pair also cannot
   contain the origin and contribute additional escape directions.
2. Uses the complete first-ray escape as an upper bound for the search. The
   disk radius includes the largest direction-vector length and tolerance.
3. Retains a pair unless a separating slab proves that its entire forbidden
   region lies outside that disk. Cauchy–Schwarz bounds the projection of every
   translation in the disk by radius times normal length.
4. Searches the original remaining directions in their original order, using
   the retained slabs. A shorter valid escape cannot encounter an omitted
   region. Nearby obstacles and chains of neighboring obstacles remain covered.

It reuses axes and temporary projection/slab storage within each body's search;
Go also reuses interval-buffer capacity. No global cache retains bodies or world
geometry. It preserves
compound fixtures, circle bounds, clearance, the direction tie rule, and the
position-only nature of recovery. The client and Go server use the same search.

A longer diagnostic profile with 6,000 measured ticks still spent 48.7% of
sampled CPU under recovery, with vertex projection the largest remaining
component. It measured 5.10 CPU ms/tick, 19.10 ms elapsed p95, 38.90 ms p99,
and a 94.04 ms maximum, with profiling overhead. This flags remaining long-run
tail cost; it must not be presented as a complete removal of collision cost.

A subsequent **unprofiled 6,000-tick pair** confirmed both the improvement and
the remaining tail. It passed the same strict outcome checks with zero measured
motion differences; both variants ended with 2,838 entities and counted
1,192,285 contacts. It is one pair, so it provides a longer correctness and
stress check rather than a repeated statistical estimate.

| 32-player modules, 6,000 ticks | Unchanged  | Optimized |
| ------------------------------ | ---------- | --------- |
| Process CPU ms/tick            | 43.227     | 5.128     |
| Elapsed tick p95 ms            | 248.733    | 18.970    |
| Elapsed tick p99 ms            | 607.254    | 39.603    |
| Largest elapsed tick ms        | 1,527.428  | 94.936    |
| Allocated B/tick               | 19,884,961 | 503,764   |
| Peak RSS MiB                   | 271.7      | 155.7     |

CPU fell 88.1% and allocation 97.5%. The optimized p99 and maximum still exceed
the 33.33 ms budget. Further conservative spatial pruning and work on remaining
projection cost are potential follow-ups; this does not establish a guarantee
for the dense stress workload or production shared CPUs.

## Firefox HUD investigation

A 20-second native Firefox profile after the collision optimization attributed
1,332.7 ms of tab CPU to `Element.clientWidth`, including synchronous style and
layout work. The HUD map read its CSS size after instrument width and text
mutations. Moving that read earlier reduced synchronous time but did not reduce
total tab CPU: other layout phases absorbed the work. That intermediate version
was replaced.

The retained change observes the map canvas's content size with `ResizeObserver`.
The first visible frame measures once; ordinary frames use the cached size.
The observer redraws the latest map when its CSS size changes, and disconnects
when the HUD is destroyed. The map renderer accepts the measured display scale
while retaining its existing default for other callers. Appearance, marker sizes,
and the responsive layout remain the same.

In the follow-up profile, CPU attributed to `clientWidth` fell to **3.8 ms**.
Tab CPU fell from 16.80 to 16.29 seconds over the 20-second capture, about 3%.
These are inclusive sampled CPU estimates using Firefox's `threadCPUDelta`;
the profiles have overhead. The retained summaries identify the raw profiles.

Ordinary 30-second flight captures measured:

| Variant, all with optimized recovery   | FPS   | Mean measured frame work ms | Frame interval p95 ms |
| -------------------------------------- | ----- | --------------------------- | --------------------- |
| Before HUD change                      | 96.46 | 7.71                        | 17                    |
| Disable backdrop blur, diagnostic only | 94.60 | 7.75                        | 18                    |
| Move size read earlier, intermediate   | 92.90 | 7.47                        | 17                    |
| Cache map size, retained               | 97.30 | 7.29                        | 17                    |

The retained variant used 5.4% less measured frame work; its small FPS difference
is within the observed run variation. These were sequential captures, not
interleaved repeated pairs. They do not establish a general FPS gain. Disabling
blur did not improve this comparison, so no blur or appearance change was kept.
The native profile also shows substantial time clearing the main frame canvas;
that path predates these three commits and was not changed here. DOM selector
and attribute setter CPU was much smaller than the layout and canvas costs.

## Browser acceptance and input timing

Ordinary final captures used the default Canvas preference, production CSS and
source transforms, active HUD assertions, and 30 seconds per scenario. All
activity and browser-error assertions passed for the following rendering cases:

| Scenario | Chromium 1440p FPS | Firefox 1440p FPS | Chromium 4K FPS | Firefox 4K FPS |
| -------- | ------------------ | ----------------- | --------------- | -------------- |
| Live     | 119.83             | 98.78             | —               | —              |
| Large    | 119.83             | 92.48             | —               | —              |
| Combat   | 119.60             | 89.07             | —               | 109.27         |
| Flight   | 119.70             | 92.24             | 119.80          | 98.53          |

The simple reference canvas remained approximately 120 FPS in all four runs.
The 1440p captures cover the full five-scenario suite in both browsers; 4K
checks target combat/flight in Firefox and flight in Chromium, with references.
One initial Chromium 4K capture overlapped test startup and was excluded; the
table uses its clean repeat. Profiler and no-blur diagnostics were excluded.

The Firefox game results are above the earlier current-revision captures, but
several 1440p cases still trail the pre-three-commit baseline. These separate
captures, taken hours apart, do not isolate how much of the FPS difference comes
from the fixes versus run order, thermal state, or scene variation. The paired
server CPU results and the eliminated map-size flush provide stronger evidence
for the specific improvements than the whole-scene FPS comparisons.

The two-client input check with 5 ms delay each way did **not** pass consistently.
Its first-response assertion remains unchanged at a remote-minus-local limit
below 60 ms. All nine captures are retained:

| Client cohort                          | First-response differences ms | Best sustained steering lags ms | Passing captures |
| -------------------------------------- | ----------------------------- | ------------------------------- | ---------------- |
| Optimized, original temporary frontend | 66.7, 50.1, 66.6              | 16, 16, 33                      | 1/3              |
| Unchanged `94969b9`, isolated frontend | 49.8, 33.4, 50.0              | −1, −1, −1                      | 3/3              |
| Optimized, same isolated frontend      | 50.0, 50.0, 83.3              | −1, −1, −1                      | 2/3              |

The Go server stayed running unchanged across these cohorts. An isolated
`94969b9` archive supplied the control frontend; then only its three changed
client files were replaced by the optimized versions. The main checkout's
product sources were preserved throughout. Each variant was built before its
captures, using the same standard frontend URL and proxy.

In the initial optimized cohort, matching tick numbers appeared on the observer
16.6–33.3 ms after the pilot, closely matching the fitted steering lag. The
unchanged controls were nearly aligned. The isolated optimized repeat also
showed nearly aligned sustained steering, so the earlier offset was not a
persistent additional playback buffer. Client clock phase established during
startup is a contributor; its timing rules were not changed by these fixes.

The startup failures remain an open timing limitation. The current harness
records an input edge after CDP key dispatch returns and compares rAF-stamped
poses; one failed trace already contained local rotation before the recorded
edge. That limits interpretation of its absolute first-response numbers.
Neither the threshold nor the clock/presentation rules were changed to make
the captures pass. This follow-up does not claim a clean input-latency sign-off.

## Validation and resource cost

- Before/after production builds passed.
- All 64 Node test entries and all Go packages passed, including collision,
  prediction, gate parity, networking, and persistence checks.
- Production UI checks passed, including startup, preferences, responsive HUD
  layout, docking, trading, repair, paint, focus, and launch.
- Lint passed after correcting two statement-spacing issues; changed source
  formatting and `git diff --check` passed.

| Emitted resource                      | Before bytes | After bytes | Change         |
| ------------------------------------- | ------------ | ----------- | -------------- |
| All JavaScript chunks                 | 269,510      | 270,583     | +1,073 (+0.4%) |
| Sum of gzip-level-1 JavaScript chunks | 112,783      | 113,259     | +476           |
| CSS                                   | 17,465       | 17,465      | 0              |
| Stripped production server            | 13,164,704   | 13,164,704  | 0              |

## Scope and evidence

The product changes are limited to client/server overlap recovery, HUD map size
tracking, and the map renderer's size option. The benchmark runner also gains a
recorded `GAMEPLAY_NO_HUD_BLUR=1` diagnostic; ordinary acceptance runs omit it.
The default Canvas renderer and the optional WebGL preference are unchanged.

Saved evidence is indexed in the
[artifact README](../../../benchmarking/experiments/2026-10-18/performance-fixes/README.md).
Large raw native Firefox
profiles remain ignored scratch output; their hashes and summarized local-tab
stacks identify the captures. Local browser sizes are verified render viewports,
not native scanout on this laptop's 1920 × 1200 display. The original fixture's
limited radar-contact coverage and evolving live world also remain limitations.
