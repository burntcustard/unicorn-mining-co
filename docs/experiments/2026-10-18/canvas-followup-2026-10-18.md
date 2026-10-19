# Canvas and radar performance follow-up — October 18, 2026

The retained rendering change requests software backing for the small, frequently
redrawn radar canvas. It is one context option in `src/client/ui/dom/hud.ts`,
shared by both browsers. Resolution, drawing frequency, contacts, world rendering,
and settings are preserved. No renderer branch or new cache is needed.

The input-response metric regression test now lives in
[`tests/client/input-response.test.ts`](../../../tests/client/input-response.test.ts).
Its contents and import depth are unchanged. The empty `tests/benchmarking`
directory was removed. Historical evidence retains its original paths.

## Measurement conditions

The browser comparisons use Chromium 155.0.8059.79 and Firefox 158.0 on the
Intel Core Ultra X7 358H laptop, with Intel integrated graphics. The physical
display is 1920 × 1200 at 119.90 Hz. Reported 2560 × 1440 and 3840 × 2160
resolutions describe the emulated viewport and canvas backing store; they do
not establish native 4K scanout.

Captures run sequentially against the standard Go/Vite services, with production
CSS, property/tag transforms, the default Canvas world renderer, native HUD,
unlocked audio, an active search light, and real simulation updates. Builds,
tests, lint, and CPU profiles do not run alongside performance comparisons.
The isolated world uses seed 1 and a five-second warmup before measurement.

FPS is application rAF cadence. The tuple called `cpu` in the runner is elapsed
main-loop work measured with `performance.now()`, not process CPU consumption
or GPU completion time. Chromium is generally limited by the display refresh
rate, so lower frame work does not establish an FPS increase.

## Exploratory candidates

Allowing a GPU-backed foreground canvas by overriding `willReadFrequently`
looked promising in the first flight cohort: median Firefox FPS increased from
86.49 to 91.71 across three alternating 30-second pairs. However, the 4K combat
probe fell from 93.01 to 75.45 FPS, and a fresh GPU combat probe reached 88.19.
Chromium stayed close to the display cap. These probes do not justify changing
the shared foreground default.

A canvas-reset experiment preserved the software foreground and restored
nearest-pixel image sampling after resetting state. In its completed guarded
flight pair, Firefox reached 99.66 FPS versus a fresh control's 100.97, with
6.57 versus 6.43 ms of frame work. It did not establish an improvement.
An earlier two-scenario reset run stalled after its combat result and was
explicitly terminated; its partial measurement is excluded.

The minimap's software-canvas hint also looked promising in Chromium. Before
retaining it, inspection found that isolated worlds inherited radar contacts
from their initial live session. Those exploratory captures are retained as
diagnostics, not evidence for a retained optimization. Later controls also
shifted substantially without product changes, so comparisons between cohorts
must not be presented as code improvements.

## Benchmark corrections

The fixture now clears inherited radar contacts and rebuilds them from its own
living asteroids at the simulation cadence. Results record the radar count and
require it to match the isolated scene; the flight comparison contains 48
contacts in every capture.

Each gameplay scenario activates the owned browser tab. Measurement records
whether the page was hidden and rejects such captures. Browser JavaScript
evaluations, including the reference canvas's frame wait, have a deadline of
the configured duration plus 20 seconds. The unclassified automation stall
above motivated these checks; it does not establish a production startup bug.

The final minimap comparison uses three alternating 30-second pairs in each
browser with the corrected radar fixture. Every candidate must beat 1% in
repeatable measurements and remain simple to qualify for retention.

## Corrected comparison

These are medians of three matched 30-second captures per variant, after the
radar correction. Every flight capture recorded 48 radar contacts and a visible
page. The foreground canvas remains on its existing software path in both
variants; only the minimap's backing hint differs.

| Browser  | Control FPS | Software radar FPS | Control frame work ms | Software radar frame work ms |
| -------- | ----------: | -----------------: | --------------------: | ---------------------------: |
| Firefox  |      100.06 |             111.83 |                 6.483 |                        5.971 |
| Chromium |      119.83 |             119.93 |                 3.031 |                        2.541 |

Firefox's median FPS increased **11.8%**. Its three paired FPS improvements were
1.44%, 12.86%, and 11.26%, so all exceeded the requested 1% threshold. The first
pair's frame work increased 2.65%; the other two decreased 10.13% and 9.08%.
Median frame work decreased 7.9%, and the median p95 frame interval improved
from 17 to 16 ms; p99 remained 19 ms.

Chromium's median frame work decreased **16.2%**. Its three paired reductions
were 16.01%, 17.01%, and 16.17%. Its FPS change is below 1% and is not claimed
as an improvement; it remains at the refresh cap. Its p95 and p99 intervals
remained approximately 8.4 ms.

A separate 30-second 4K combat pair in each browser checked the workload that
made the full-foreground GPU experiment unattractive:

| Browser  | Control FPS | Software radar FPS | Control frame work ms | Software radar frame work ms |
| -------- | ----------: | -----------------: | --------------------: | ---------------------------: |
| Firefox  |      117.50 |             119.00 |                 5.713 |                        5.875 |
| Chromium |      119.70 |             119.77 |                 3.269 |                        2.910 |

This is one pair per browser, not a repeated estimate of a 4K gain. Firefox FPS
increased 1.27%, with **2.84% more frame work**; p95 remained 9 ms and p99
improved from 16 to 12 ms. Chromium's frame work decreased 11.0%, with unchanged
refresh-limited FPS and p95/p99 intervals. The retained change is supported by
the repeated flight gains and this combat check, not a claim that every timing
metric improves in every workload.

## Profiles and remaining cost

Separate 20-second Firefox 4K combat profiles compared the original minimap and
the software hint. They include profiler overhead and an unminified fixture,
and are excluded from acceptance statistics. Sampled local-tab CPU was
15.92 seconds for the control and 16.65 for the software radar. Profiled FPS
was 116.20 and 115.86. These do **not** establish a total CPU saving.

`CanvasRenderingContext2D.clearRect` still accounted for approximately 4.87
seconds of sampled tab CPU in each profile, about 29–31%. This aggregates
canvas contexts; it does not isolate one surface's cost. Full-canvas clearing
remains a substantial hotspot. The explored full-foreground GPU and reset
alternatives did not justify changing that path. The retained radar hint is a
small FPS/frame-work improvement, not a complete removal of rendering cost.

## Verification and footprint

The production build, all 65 TypeScript test entries, all Go package tests,
lint, and the complete visible Chromium production UI/startup check passed.
The latter covers deferred startup, navigation, preferences, identity, preview,
desktop layout, trading, repairs, paint, focus, and launch.

Ten-second shipping-source smoke captures also passed in both browsers for
large fractures, combat, flight, and the reference canvas, with every diagnostic
switch off. The runner verified software minimap attributes, active audio/HUD,
matching radar counts, no hidden page, and no browser errors. These are smoke
checks, not the paired improvement estimate. Chromium measured 119.90/119.80/
120.00 FPS for the three gameplay cases; Firefox measured 102.36/105.40/103.81.
The references measured 119.66 and 119.27 FPS respectively.

Two deliberate invalid-capture probes passed: a hidden-page result was rejected,
and an unresolved measurement hit the evaluation deadline. Both reached the
injected measurement, exited with the expected error, and cleaned up their
owned browsers. Their nonzero exits are intentional test results.

| Resource                      | Before bytes | After bytes | Change |
| ----------------------------- | -----------: | ----------: | -----: |
| JavaScript total              |      270,666 |     270,690 |    +24 |
| JavaScript gzip level 1 total |      113,291 |     113,290 |     −1 |
| CSS total                     |       17,465 |      17,465 |      0 |
| Stripped Go server            |   13,164,704 |  13,164,704 |      0 |

Captures, source snapshots, candidate patches, profile summaries, reproduction
metadata, and verification logs are retained in the
[evidence directory](../../../benchmarking/experiments/2026-10-18/canvas-followup/).
The raw native profiles remain in ignored local output; their exact paths and
hashes are recorded with the evidence. This change is local and has not been
deployed.
