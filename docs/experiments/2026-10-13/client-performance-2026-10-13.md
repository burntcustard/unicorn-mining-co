# Client gameplay performance — 2026-10-13

> Evidence for this completed investigation is in the
> [2026-10-13 archive](../../../benchmarking/archive/README.md#2026-10-13).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-13`.

The [4K follow-up](client-performance-4k-2026-10-13.md) adds a renderer setting,
reviews these uncommitted changes, and fixes the docking test assumptions
recorded below. The captures in this report retain their original metadata.

The retained client meets the user's accepted target of at least 119.8 FPS in
Chrome and Firefox at native 2560 × 1440 resolution and default zoom (1.5).
The user initially requested matching the display baseline, then clarified that
119.8 FPS is close enough in both browsers. Occasional refresh gaps remain;
this result does not claim that every individual frame takes less than 8.33 ms.

## Device and method

The device has a Ryzen 7 5800X3D and an NVIDIA RTX 5070 Ti with driver
580.173.02. The primary display is 3840 × 2160 at 120 Hz; the secondary display
runs at 60 Hz. Owned, visible browser windows were placed on the primary display
and verified to contain a 2560 × 1440 viewport and backing canvas, with DPR 1.
Browser versions were Chrome 155.0.8059.39 and Firefox 157.0.1.

The [runner](../../../benchmarking/tools/gameplay-performance.ts) uses production
property/tag transforms and separately emitted lazy chunks. Audio is unlocked
by a trusted keyboard event. Workloads are:

- **Live:** normal Go networking, launch transition, straight flight, searchlight,
  replication, and reconciliation.
- **Large:** four large asteroids, an equipped autogun, active searchlight, and
  repeated asteroid splits/destruction.
- **Combat:** a dense deterministic field of 48 asteroids, autogun fire, cargo
  revelation, searchlight/refraction, and asteroid fractures.
- **Flight:** continuous ship and camera movement through a field that keeps
  38–42 asteroids visible while firing and using the searchlight.
- **Reference:** a minimal animated canvas on the same display.

Isolated workloads use the real 30 Hz simulation and ten 200-round ammunition
packs. They must consume ammunition; fracture workloads must split asteroids.
Flight recycles rocks already outside the viewport before pose capture and
records visible-rock counts. Live flight separately covers real server updates.
Captures run sequentially, without concurrent builds, tests, or profilers.

Frame cadence uses requestAnimationFrame timestamps. A gap above 12.5 ms counts
as a missed 120 Hz refresh. CPU timings cover the main loop and exclude deferred
GPU work. Firefox's ordinary timer is quantized. These are application timing
measurements, not hardware scanout measurements or guarantees for other devices.

## Final measurements

Each final workload runs for 60 seconds. All four gameplay workloads exceed
119.8 FPS in both browsers. Chrome matches its measured display reference.

| Browser | Workload  |     FPS | Missed refreshes | Mean CPU | CPU p95 | Longest gap |
| ------- | --------- | ------: | ---------------: | -------: | ------: | ----------: |
| Chrome  | Live      | 119.855 |                9 |  1.77 ms | 3.50 ms |    16.70 ms |
| Chrome  | Large     | 119.888 |                7 |  1.83 ms | 3.90 ms |    16.70 ms |
| Chrome  | Combat    | 119.905 |                6 |  3.02 ms | 5.00 ms |    16.70 ms |
| Chrome  | Flight    | 119.905 |                6 |  1.56 ms | 3.00 ms |    16.70 ms |
| Chrome  | Reference | 119.822 |               11 |  0.00 ms | 0.00 ms |    16.80 ms |
| Firefox | Live      | 119.819 |                8 |  2.99 ms | 5.00 ms |    33.24 ms |
| Firefox | Large     | 120.000 |                0 |  2.62 ms | 5.00 ms |     9.24 ms |
| Firefox | Combat    | 119.882 |                7 |  3.67 ms | 6.00 ms |    17.14 ms |
| Firefox | Flight    | 119.950 |                3 |  2.51 ms | 5.00 ms |    17.12 ms |
| Firefox | Reference | 120.000 |                1 |  0.62 ms | 1.00 ms |    17.12 ms |

The Firefox live capture includes a 33.24 ms gap and the combat capture includes
seven missed refreshes. The averages meet the clarified acceptance threshold;
Firefox still has more occasional scheduling/collection gaps than its minimal
reference. Large-fracture and combat captures consumed 255 rounds each.

[Chrome final data](../../../benchmarking/archive/README.md#2026-10-13)
and [Firefox final data](../../../benchmarking/archive/README.md#2026-10-13)
contain activity checks, frame gaps, timing distributions, and browser errors.
Screenshots retain the [Firefox combat](../../../benchmarking/archive/README.md#2026-10-13)
and [large-fracture](../../../benchmarking/archive/README.md#2026-10-13)
scenes, plus [Chrome combat](../../../benchmarking/archive/README.md#2026-10-13)
and [large fractures](../../../benchmarking/archive/README.md#2026-10-13),
at native resolution.

Corrected original-client combat captures, each 30 seconds, measured:

| Browser |     FPS | Mean CPU |  CPU p95 | Longest gap |
| ------- | ------: | -------: | -------: | ----------: |
| Firefox |  53.869 | 18.40 ms |    29 ms |    41.36 ms |
| Chrome  | 119.671 |  4.48 ms | 11.30 ms |    16.70 ms |

The [Firefox](../../../benchmarking/archive/README.md#2026-10-13)
and [Chrome](../../../benchmarking/archive/README.md#2026-10-13)
baselines use the matching deterministic combat workload. Capture duration
changed from 30 to 60 seconds, so compare rates/distributions rather than raw
miss counts. Earlier captures with incorrect simulation cadence, suspended
audio, stationary flight, or incomplete drawing are excluded.

## Retained implementation

Chrome's long native-path GPU flushes required a world-rendering adapter.
[DrawingPath](../../../src/client/utilities/drawing-path.ts) records native-compatible
paths, [path-mesh](../../../src/client/utilities/path-mesh.ts) caches their geometry,
and [WorldRenderer](../../../src/client/utilities/world-renderer.ts) batches it
through WebGL2. Gameplay keeps its drawing calls and calculation names. The HUD
uses a separate native Canvas so font rendering remains sharp. Unsupported
WebGL2 falls back to native Canvas. Firefox retains native Canvas and cached
surfaces moved through its compositor because its direct WebGL experiment was
slower. No server source, wire schema, or catalog data changed.

Other retained improvements reduce drawing, copying, and garbage collection:

- Cache three parallax layers and move them with CSS; repaint only when the
  camera exhausts their covered margin. Cull offscreen artwork while keeping
  fitted craft whose beams can cross the viewport.
- Share immutable asteroid/item geometry, reuse bounded circle/sparkle paths,
  reuse drill stripe paths, and cache blurred searchlight and docking images.
  Recycle retired artwork canvases through a bounded pool.
- Clip cargo revelation on a small native-resolution surface, clear/upload only
  its used rectangle, and preserve nested clipping and lightening blends.
- Cache Firefox hull-lighting ramps as transformed gradient patterns. Their
  256 samples change color interpolation slightly, without reducing the world
  canvas resolution. Asteroid outlines use bevel joins; world edges can have
  slightly different antialiasing.
- Reuse display-prediction copies and motion endpoints, share frozen geometry,
  omit unfitted shop stock from the private display solve, and avoid restoring
  a freshly copied world. Authoritative history and live inventory stay complete.
- Store compact checkpoints and reuse unchanged inventory/mechanics records.
  Preserve independent old records when health, module cooldowns, cargo, or
  shared random state changes. Replace allocation-heavy callbacks in cloning
  with measured loops and avoid rebuilding mounted-module arrays for visuals.
- Reject searchlight rays using polygon bounds before checking edges; keep ray
  count, refraction, spectrum, and fade behavior. Find outer edges through
  adjacency rather than repeated whole-component searches.
- Bake repeated whole HUD labels into a bounded cache, preserving native font,
  kerning, outline, alignment, and opacity. Update changing readouts separately.

The renderer files isolate the new backend rather than duplicating gameplay or
server calculations. No WASM, worker simulation, or new runtime dependency was
needed. The added adapter is nevertheless a meaningful increase in client code
and download size, recorded below.

## Rejected experiments and diagnostic evidence

Lower internal resolution was explicitly rejected by the user. All retained
acceptance captures use a 2560 × 1440 backing canvas. The Firefox capture preceded
formatting-only changes and the Chrome WebGL-unavailable fallback; its renderer
and simulation behavior are unchanged.

Native rotated asteroid bitmap caches reduced Firefox FPS. Full-resolution CPU
foreground transfer through WebGL/bitmap presentation fell to roughly 74–79
FPS. Direct WebGL in Firefox measured roughly 85–88 FPS, so it was not retained.
A GPU-backed cached surface, cached whole-craft surface, separate GPU HUD,
per-glyph font rendering, and shader-based backgrounds did not justify their
cost/complexity. Additive interior lighting changed the appearance without a
useful gain. Experiments omitting hull drawing or cargo revelation were diagnostic
only and are excluded from acceptance measurements.

Chrome traces identified expensive native-path flushes even when JavaScript
was fast. A prototype WebGL feedback-loop bug initially dropped geometry;
those results were discarded. The retained renderer unbinds its presentation
texture before rendering the next frame and checks for GL errors in captures.

Firefox profiles found small ordinary style/layout costs and collection slices
up to 9.1 ms, plus an idle ForgetSkippable slice of 10.5 ms. Long major-collection
intervals span multiple slices and are not continuous pauses. Sampled allocation
profiles showed cloning callbacks and repeated module getters as substantial
allocation sources. Replacing clone callbacks cut sampled lexical-environment
allocation by about 48% and cloning-leaf allocation by about 62% in the paired
20-second diagnostic. The [before](../../../benchmarking/archive/README.md#2026-10-13)
and [after](../../../benchmarking/archive/README.md#2026-10-13)
summaries retain the sampled evidence. These totals are directional evidence;
profiling adds overhead and the ordinary captures above determine acceptance.

## Validation and resources

`npm run build`, `npm run lint`, and the complete `npm run test` suite passed:
53 Node tests passed, plus the Go package suite. Regression coverage includes
physics/prediction consistency with Go, cargo and RNG rollback, module cooldown
history, asteroid fractures, geometry ordering, input, text caching, composited
surface reuse, and production property mangling.

Production-transformed graphics checks compare native Canvas interior pixels
with the WebGL adapter. Concave fills, nonzero holes, even-odd overlaps, nested
clips, restore, translucent lightening, gradients, transforms, cropped changing
canvas uploads, translucent ImageBitmap uploads, and repeated frame/draw order
agree within two color levels at the sampled pixels. Gameplay screenshots were
inspected for beams, revealed cargo, rainbow, asteroid outlines, ship, and HUD.

Production startup/lazy-loading validation passed in visible Chrome, including
deferred preparation, connection reuse, delayed identity, failed loading,
navigation, and immediate Play. Headless software-rendered gameplay stalled
on this device, so the startup check used the real display GPU. The UI checker
now supports `UI_HEADFUL=1` and observes frame/target drawing on either renderer.
A separate full docking fixture has a pre-existing pointer/focus expectation
mismatch: it expects a
mouse-focused item to retain keyboard hover on pointer exit, while unchanged
product code retains it only for `:focus-visible`. This is recorded separately
from the rendering and gameplay checks.

[Resource sizes](../../../benchmarking/archive/README.md#2026-10-13)
compare the original build with the final build; gzip uses Node's level 1, as
in the production budget check. Loading triggers are unchanged.

| Resource                | Original bytes / gzip 1 | Final bytes / gzip 1 |
| ----------------------- | ----------------------: | -------------------: |
| HTML                    |           4,433 / 2,278 |        8,002 / 3,687 |
| Entry JavaScript        |           8,801 / 3,785 |        8,939 / 3,830 |
| Shared CSS              |           7,001 / 2,744 |        7,507 / 2,897 |
| Gameplay JavaScript     |         65,723 / 28,744 |      92,447 / 39,177 |
| Shared ship JavaScript  |         77,680 / 33,893 |      85,089 / 36,977 |
| Ship preview JavaScript |           5,124 / 2,562 |        5,129 / 2,579 |

Gameplay and ship chunks already exceeded the 14 KB gzip budget before this
work; their download size grows. The complete resource JSON includes small
hash/name changes in other chunks. Temporary investigation services and owned
browser processes are stopped when validation finishes.
