# Native 4K gameplay performance — 2026-10-13

> Evidence for this completed investigation is in the
> [2026-10-13 archive](../../../benchmarking/archive/README.md#2026-10-13).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-13`.

The target is at least 100 FPS during the established gameplay workloads in
Chrome and Firefox at native 3840 × 2160 resolution and default zoom 1.5.
The optimized client passed all four 60-second gameplay workloads in both
browsers after the simplification review, including every measured one-second
window. Occasional refresh gaps remain and are reported separately. These
initial acceptance captures preceded the docking-bay correction documented
below, which includes updated Firefox validation.

## Measurement and acceptance

Use the same Ryzen 7 5800X3D, RTX 5070 Ti, and primary 120 Hz display as the
[1440p investigation](client-performance-2026-10-13.md). Owned fullscreen windows
cover the primary display. The viewport and world backing canvas are both
3840 × 2160, with DPR 1 and rendering resolution 100%. Internal resolution was
not reduced. Chrome is 155.0.8059.39 and Firefox is 157.0.1.

The production-transformed runner retains the original live flight, large
asteroid fractures, dense ammunition-backed combat, continuous flight, and
minimal display-reference workloads. Audio runs normally. Combat consumes real
ammunition and fractures asteroids; flight moves both the ship and camera and
keeps asteroids visible. Each final workload runs for 60 seconds, one browser at
a time, with builds, tests, and profilers stopped.

In addition to average FPS and frame-gap distributions, the runner records
consecutive roughly one-second throughput windows. `fps-windows[0]` is the
lowest completed window; the remaining values are the individual windows.
Acceptance requires every measured gameplay window to stay at or above 100 FPS.
This catches slow periods hidden by a near-120 FPS overall average. It does not
claim that every individual refresh arrives on time. rAF timestamps measure
application cadence rather than hardware scanout.

Configure resolution with `GAMEPLAY_RESOLUTION=3840x2160`. The 1440p default is
unchanged. Fullscreen uses the browser's window-state API, including the
[WebDriver BiDi fullscreen state](https://www.w3.org/TR/webdriver-bidi/#command-browser-setClientWindowState)
in Firefox. The minimal reference now uses a GPU-friendly opaque Canvas;
the earlier CPU-backed reference was itself too expensive at 4K in Chrome and
was unsuitable for measuring display cadence.

## Results

| Browser | Workload  | Average FPS | Lowest one-second FPS |  CPU mean / p95 | Longest gap |
| ------- | --------- | ----------: | --------------------: | --------------: | ----------: |
| Chrome  | Live      |     119.871 |                119.00 |  1.55 / 3.30 ms |    16.80 ms |
| Chrome  | Large     |     119.305 |                105.00 |  2.03 / 5.10 ms |    25.00 ms |
| Chrome  | Combat    |     119.572 |                111.08 |  2.97 / 5.00 ms |    16.80 ms |
| Chrome  | Flight    |     119.888 |                119.00 |  1.47 / 2.90 ms |    16.80 ms |
| Chrome  | Reference |     119.922 |                     — |  0.00 / 0.00 ms |    16.70 ms |
| Firefox | Live      |     119.741 |                115.97 |  4.94 / 7.00 ms |    38.58 ms |
| Firefox | Large     |     119.218 |                102.97 |  5.24 / 8.00 ms |    33.26 ms |
| Firefox | Combat    |     119.632 |                115.98 | 6.39 / 10.00 ms |    41.30 ms |
| Firefox | Flight    |     119.951 |                118.99 |  4.78 / 7.00 ms |    17.12 ms |
| Firefox | Reference |     119.866 |                     — |  0.01 / 0.00 ms |    33.24 ms |

[Chrome data](../../../benchmarking/archive/README.md#2026-10-13)
and [Firefox data](../../../benchmarking/archive/README.md#2026-10-13)
retain activity checks, timing distributions, individual stalls, native dimensions,
and browser errors. [Chrome](../../../benchmarking/archive/README.md#2026-10-13)
and [Firefox](../../../benchmarking/archive/README.md#2026-10-13)
screenshots show native 4K combat, searchlight/refraction, revealed cargo, and HUD.

Before simplification, the 60-second gameplay runs passed:

| Browser | Average FPS range | Lowest one-second gameplay rate |
| ------- | ----------------: | ------------------------------: |
| Chrome  |     119.57–119.89 |                      113.00 FPS |
| Firefox |     119.15–119.82 |                      103.22 FPS |

Firefox retained isolated longer frame gaps, including 58.44 ms in combat.
These are included in the raw data and are not hidden by reporting averages.

## Renderer choice and lighting

Graphics settings now expose **World renderer: Auto / Canvas / WebGL2**. The
choice is stored locally and takes effect after reloading because a canvas's
context type is fixed. Either renderer is available in either browser.
Auto keeps the measured defaults for this device: WebGL2 in Chrome and Canvas
in Firefox. Browser checks are consolidated in that initial default; native
compositor caches follow the available drawing API rather than browser names.
The override lets users compare behavior on another OS, GPU, or driver.

Chrome's probe identifies ANGLE on the RTX 5070 Ti. Firefox masks its renderer
string as an NVIDIA GTX 980 or similar, so it does not identify the actual GPU.
These probes do not establish that one entire browser has GPU acceleration
disabled. The measured drawing/composition pipelines have different costs.
Firefox's current WebGL2 combat path measured about 51.58 FPS at 4K, versus
roughly 119 FPS with its native Canvas/compositor path.

The initial station-floor experiment reused native-resolution artwork until a station turned
at least five degrees. Movement and rotation transforms still updated every
frame. Geometry, health, paint, and rendering-scale changes invalidated the
image immediately. Fitted modules, projected beams, and dynamic floor geometry
retained their normal drawing path. Cached floors were GPU-backed; static
asteroid artwork kept its measured CPU backing. At that stage, native Canvas regression checks
verified reuse after a one-degree turn and immediate redraw after a larger turn,
damage, and resizing. The later docking-bay correction removed this floor cache;
the large station guide and glow images remain cached.

That initial diagnostic kept the station visible during combat. The station floor itself
repainted four times rather than every frame; its guide repainted once. The
remaining per-frame floor canvas was the moving rainbow. CPU/FPS gains were
modest because the station's main hull panels still draw separately. This
additional scene is diagnostic and differs from the original acceptance field.

Hull lighting already uses precomputed tint tables and cached gradient ramps.
HUD numeric bitmaps redraw only when their text changes. Ordinary coordinate
changes come from the 30 Hz simulation rather than the interpolated display
pose, so adding another text delay offers little value. Drill stripe geometry
and the station guide are already cached; their motion stays at full refresh
rate. No animation-rate limit or corresponding setting was added.

## Review of the uncommitted changes

The review covered rendering and composition, lighting/refraction, text,
geometry, replication, prediction/checkpoint allocation, loading boundaries,
property rewriting, and their regression tests.

An attempted shared Canvas renderer would have removed the specialized WebGL
adapter. Longer Chrome 4K captures rejected that simplification: large-fracture
windows fell to 90 FPS and combat windows to 59.02 FPS. Live flight also had a
91.7 ms gap. The isolated WebGL adapter remains necessary for the accepted
Chrome result on this device, despite a promising short Canvas pilot.

Retained simplifications and fixes:

- Remove the unused surface-density option; all artwork caches use native
  world pixel density.
- Share the immutable-member predicate used by clone-array checks.
- Simplify bounded text-cache eviction.
- Preserve the native iterator method `next` in production property rewriting.
  The previous forced rename could break cache eviction after reaching a bound.
  A production regression now covers the native iterator call.
- Validate cached searchlight geometry before reuse. A function that changes its
  output must refresh the beam mask; a stable function keeps its baked image.
  The regression checks changing geometry without depending on an effect spec.
- Keep the production UI fixtures in separate virtual source modules, so both
  receive normal property transforms without duplicate declarations.

Removing the searchlight path cache entirely was rejected: the default model
returns a new coordinate array, so that version rebaked blurred images every
frame and reduced Firefox gameplay to about 103 FPS with much lower one-second
windows. The retained coordinate comparison restores stable image reuse and
fixes stale masks for genuinely dynamic geometry. That failed capture is
excluded from acceptance.

The physics calculations, wire schema, server source, and catalog data remain
unchanged. The compact checkpoint and geometry caches retain their correctness
checks for RNG aliases, sparse arrays, metadata, deletion, cargo, module state,
fracture ordering, and Go/client consistency.

## Validation and resources

Before the review, all 53 Node tests and the Go suite passed. Production browser
checks passed for startup/loading, renderer preferences, graphics, station cache
invalidation, and docking. Two old docking test assumptions were corrected to
match existing behavior: mouse-focused rows deactivate on pointer exit, and a
card receives keyboard focus when all its actions are disabled. Docking product
code did not change.

After the review and final benchmarks, the full suite passed again: all 53
Node tests and the Go package suite, plus the complete production browser check
for startup, navigation, preferences, identity, previews, layout, trading,
repairs, paint, focus, cache invalidation, and launch. The final build, lint,
and source formatting checks passed. Native 4K screenshots were inspected.

Resource sizes below compare the
retained 1440p implementation at the beginning of this follow-up with the final
reviewed 4K implementation. Gzip uses Node level 1, matching the build check.
Loading triggers are unchanged.

| Resource        | Before bytes / gzip 1 | Final bytes / gzip 1 |
| --------------- | --------------------: | -------------------: |
| docked.js       |       29,131 / 10,478 |      29,126 / 10,476 |
| gameplay.js     |       92,447 / 39,177 |      92,806 / 39,319 |
| index.html      |         8,002 / 3,687 |        8,147 / 3,746 |
| index.js        |         8,939 / 3,830 |        9,229 / 3,946 |
| keybindings.js  |           1,580 / 743 |          1,580 / 745 |
| menu-screens.js |        12,348 / 4,308 |       12,827 / 4,471 |
| shield.js       |         5,104 / 2,227 |        5,104 / 2,228 |
| ship-preview.js |         5,129 / 2,579 |        5,129 / 2,577 |
| ship.js         |       85,089 / 36,977 |      85,204 / 37,008 |

[Complete resource data](../../../benchmarking/archive/README.md#2026-10-13)
includes unchanged resources. Original pre-investigation sizes remain in the
1440p report.

The final 30-second 1440p regression captures preserve the earlier 119.8 FPS
acceptance threshold: Chrome gameplay measured 119.91–119.94 FPS, and Firefox
119.83–119.96 FPS. [Chrome](../../../benchmarking/archive/README.md#2026-10-13)
and [Firefox](../../../benchmarking/archive/README.md#2026-10-13)
data retain their original metadata.

The final renderer settings are shown in the [Graphics screenshot](../../../benchmarking/archive/README.md#2026-10-13).
Temporary browser and Go/Vite processes started for the investigation are
stopped; pre-existing user processes are preserved.

## Firefox docking-bay correction

A follow-up visual check reproduced the reported seam in Firefox 157.0.1.
The cached floor lived on a separate DOM canvas, while the ceiling and upper
additive glow were drawn on the foreground canvas. This made the translucent
halves differ in brightness. Drawing the cached floor image into the foreground
corrected that blending, but rotating only one rasterized half still introduced
a thin line against the ceiling's vector edge.

The final correction removes the station-floor raster cache. Both bay halves
and their glows now draw on the same foreground canvas with the same transforms.
The bay fill is a small, flat translucent polygon; it has no gradient lighting
to cache. The existing glow images, hull gradient ramps, and large station guide
remain cached. This removes about 130 lines from the station implementation.
Server code and station specifications are unchanged.

Firefox checks used native 2560 × 1440 and 3840 × 2160 at default zoom 1.5,
with station angles 0°, 30°, 90°, 170°, 170.5°, 171°, 174.9°, 175.1°, and 180°.
Production-transformed native pixel checks compare the real connected rendering
with a detached direct-canvas reference at three angles, sampling both halves
and their joining edge. All sampled RGBA channels matched exactly in Firefox.
The station guide still repaints only when its geometry or rendering scale changes.

[Before at 1440p](../../../benchmarking/archive/README.md#2026-10-13), [after at 1440p](../../../benchmarking/archive/README.md#2026-10-13), [after at 4K](../../../benchmarking/archive/README.md#2026-10-13), and [visual-check metadata](../../../benchmarking/archive/README.md#2026-10-13).

All 53 Node tests, all Go test packages, build, lint, and the complete production
UI suite passed after the correction. The gameplay chunk shrank from 92,806 to
91,883 bytes, or 39,319 to 38,944 bytes with gzip level 1. Ship and preview chunk
sizes did not change.

The four established Firefox workloads were rerun for 30 seconds each at native
4K after the correction:

| Workload | Average FPS | Lowest one-second FPS |
| -------- | ----------: | --------------------: |
| Live     |      119.30 |                116.03 |
| Large    |      119.51 |                115.46 |
| Combat   |      119.60 |                111.05 |
| Flight   |      119.70 |                114.02 |

[Updated Firefox acceptance data](../../../benchmarking/archive/README.md#2026-10-13). Every measured one-second window remained above 100 FPS.

A separate, denser diagnostic moves the station to (450, 300), keeping its hull
and rotating bay visible alongside the 48-asteroid combat fixture. Its 60-second
run averaged 103.17 FPS, with a lowest one-second window of 90.29 FPS and
a longest refresh gap of 55.56 ms. This diagnostic does **not** meet the
100 FPS window threshold; the earlier station-visible diagnostics also had
sub-100 FPS windows. It differs from the four established acceptance workloads
and is recorded separately rather than being included in their passing result.
[Station-visible stress data](../../../benchmarking/archive/README.md#2026-10-13).
