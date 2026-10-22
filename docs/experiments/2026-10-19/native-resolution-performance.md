# Native-resolution performance — October 19, 2026

> Evidence for this completed investigation is in the
> [2026-10-19 archive](../../../benchmarking/archive/README.md#2026-10-19).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-19`.

The physical display is 1920 × 1200 at 119.90 Hz. The corrected runner enters
fullscreen without viewport emulation and rejects a mismatched screen, viewport,
or device-pixel ratio. The retained-change and power-policy comparisons use
1920 × 1200, DPR 1, production transforms, normal HUD/audio/lighting, and the
default Canvas renderer. Rejected diagnostics identify their changed settings.
Earlier oversized virtual viewports do not establish performance at this native
display resolution.

The retained text change measures and rasterizes ready text on its existing
bitmap canvases, reuses a bounded pool of 32 bitmaps, and avoids unnecessary font
setup on the visible canvas. It adds four net source lines and no browser branch,
new renderer, graphics preference, or resolution reduction. The world/HUD canvas
arrangement and software minimap hint are preserved.

The 110 FPS target is verified using both averages and consecutive one-second
windows. **Balanced power still fails that target in Firefox.** A temporary
Performance power-profile hold reached approximately 120 FPS in every completed
case in both browsers, including Firefox live-network gameplay. The hold released
back to Balanced during the comparison. Independent 60-second repeats also
passed. On October 19, the user selected Performance while plugged in. The
profile was enabled with AC power connected, and both the system profile and
CPU energy preference were verified as `performance`.

## Paired text-renderer comparison

Both variants use the current working tree. The control substitutes only the
exact previous `ui/text.ts`, preserving the earlier collision, HUD, networking,
and startup fixes. Captures run sequentially, with five seconds of warmup and
30 seconds of measurement per case, on plugged-in Balanced power with CPU energy
preference `balance_performance`. Builds, tests, and profiles run separately.

`Frame work` is elapsed main-loop work measured with `performance.now()`, not
process CPU consumption or GPU completion time. Chromium is refresh limited;
its reduced frame work is a headroom improvement, not an FPS gain.

| Browser  | Workload        | Previous FPS | Updated FPS | Previous frame work ms | Updated frame work ms |
| -------- | --------------- | -----------: | ----------: | ---------------------: | --------------------: |
| Firefox  | Large asteroids |       108.80 |      107.37 |                  5.799 |                 5.645 |
| Firefox  | Combat          |       110.77 |      109.62 |                  6.360 |                 6.136 |
| Firefox  | Flight          |       109.38 |      110.24 |                  5.804 |                 5.219 |
| Chromium | Large asteroids |       119.83 |      119.77 |                  2.430 |                 2.183 |
| Chromium | Combat          |       119.77 |      119.73 |                  2.908 |                 2.448 |
| Chromium | Flight          |       119.63 |      119.73 |                  2.448 |                 2.104 |

Frame work decreased 2.7%, 3.5%, and 10.1% in Firefox, and 10.2%, 15.8%, and
14.1% in Chromium. Firefox FPS was mixed, so this does not establish a universal
FPS gain. Earlier checked flight probes also reduced frame work. The code is
retained for the measured work reductions; it has not independently met the
110 FPS target under Balanced power.

The updated Balanced Firefox captures had lowest one-second windows of
95.43/102.08/99.80 FPS in large asteroids/combat/flight. Chromium's corresponding
minima were 117 FPS in all three cases.

## Power and scheduling

Both browsers use the Intel integrated GPU. Firefox's owned-profile inspection
reported WebRender, Wayland, enabled canvas acceleration, and disabled software
WebRender. Acceleration availability and a `willReadFrequently` hint do not prove
which backend a particular context used.

On the 16-core Intel Core Ultra X7 358H, the first four cores have maximum
frequencies of 4.7–4.8 GHz, the next eight 3.7 GHz, and the last four 3.3 GHz.
The owned Firefox content process was often scheduled on the middle group.
Temporarily pinning only that owned browser tree to cores 0–3 produced 117.48 FPS
and a lowest one-second window of 114 FPS. That diagnostic is excluded from
normal-scheduling acceptance. User processes were preserved.

A separate `powerprofilesctl launch --profile performance` command temporarily
held the system's supported Performance profile. CPU energy preference changed
to `performance`; the normal launcher and unrestricted CPU scheduling were
preserved. Every rendering setting, including panel blur, stayed enabled.

| Browser  | Workload        | 30-second average FPS | Minimum one-second FPS | 60-second average FPS | Minimum one-second FPS |
| -------- | --------------- | --------------------: | ---------------------: | --------------------: | ---------------------: |
| Firefox  | Large asteroids |                119.87 |                 118.00 |                119.82 |                 116.00 |
| Firefox  | Combat          |                119.87 |                 119.00 |                119.84 |                 118.00 |
| Firefox  | Flight          |                119.83 |                 119.00 |                119.90 |                 118.17 |
| Chromium | Large asteroids |                119.87 |                 118.03 |                119.92 |                 118.00 |
| Chromium | Combat          |                119.93 |                 119.00 |                119.87 |                 119.00 |
| Chromium | Flight          |                119.87 |                 119.00 |                119.93 |                 118.99 |

Live-network gameplay also passed with ship/camera movement and normal
networking, HUD, audio, and lighting: Firefox reached 119.90 FPS, minimum 119 FPS;
Chromium reached 119.83 FPS, minimum 118.02 FPS.
These results identify power policy as a material contributor. They do not
establish that Balanced now sustains 110 FPS. The temporary hold automatically
restored Balanced and `balance_performance`, which was checked afterward.

## Rejected candidates and measurement corrections

Only repeatable improvements exceeding 1% with low implementation complexity
qualify for retention. The investigation tested native canvas backing hints,
matching-density HUD sharing, text setup variants, offscreen text canvases,
radar batching/path reuse, native gradients, bitmap presentation, surface backing,
DOM update deferral, WebGL variants, clearing methods, CSS containment, compiler
options, and module-model copying. None of these additional changes is retained.

With the updated text cache and separate HUD, the accelerated world-canvas hint
improved Firefox combat from 109.83 to 113.70 FPS but reduced flight from 111.86
to 108.19 FPS. This tradeoff did not justify changing the shared default.

The checked shared-canvas/GPU-hint flight control reached 109.66 FPS, minimum
98.62. True OffscreenCanvas text reached 108.62 FPS and was rejected. Deferring
surface/background DOM work failed to establish a sufficient FPS improvement.
Module-model sharing gained less than 1% against matched controls. Compiler
variants also stayed within 1% of a fresh normal control.

Disabling panel blur improved the first large-asteroid capture substantially,
but did not reliably clear the FPS target: the first combat minimum was 108,
and repeated flight minima were 106–111.11. A fresh flight comparison was
113.03 FPS with blur and 114.13 without it, a 0.98% change. No browser-specific
blur default or setting has been added on this evidence.

Two experiment-harness mistakes were found and corrected:

- Earlier reset probes accessed a native API through a property name rewritten
  by the production minifier. They ran the fallback. Corrected probes invoked
  the real API through an unmangled lookup and did not justify retention.
- The first local queue did not select its diagnostic driver for newly added
  text/layout modes and accidentally enabled the blur diagnostic for some names.
  Those labels cannot substantiate their named changes. Their raw metadata is
  preserved, and an earlier progress claim that one passed with blur preserved
  was corrected. Replacement captures use explicit configurations, feature
  metadata checks, actual CSS blur/HUD checks, and retained compiled sources.

A Chromium live capture was excluded because camera movement was below the
fixture's threshold. It recorded running audio and no browser errors. A separate
capture crossed the battery-to-AC transition and failed audio validation; it was
excluded. Captures from uncertain power periods are not used to establish wins.
Historical evidence remains unchanged.

## Verification and footprint

The final text implementation passed the production build, all 65 TypeScript
test entries, all Go package tests, lint, and the complete visible Chromium
production UI/startup check. Pixel checks use an independent native-text
reference across three world resolutions and four display densities, rather
than comparing immediate bitmap caching against itself. Unit checks cover
state restoration, font fallback, alignment, readout changes, bounded allocation,
and bitmap reuse.

The reusable runner additionally records host power policy before/after each
scenario and rejects a change. Final short captures in both browsers verified
these fields for large asteroids, combat, flight, and the reference canvas.
They are validity smoke checks, not additional performance estimates.

Production JavaScript changed from 270,690 to 270,780 bytes; the sum of per-chunk
gzip-level-1 sizes changed from 113,290 to 113,324 bytes (**+90/+34 bytes**).
CSS, font, and Go executable sizes are unchanged. The previous input-response
test move to `tests/client` and removal of `tests/benchmarking` remain intact.

## Evidence and accepted power profile

The [saved evidence](../../../benchmarking/experiments/2026-10-19/native-resolution-performance/) includes
native screen metadata, exact previous/current text, power-policy sidecars,
requested experiment flags, compiled fixtures, source patches, validation logs,
and checksums. The user selected Performance while plugged in, and that profile
is now enabled on AC power. Both browsers satisfy the 110 FPS target under this
accepted power policy in the repeated native-resolution captures. The Balanced
results remain unchanged and do not establish that target in Firefox.
