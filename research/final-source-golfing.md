# Final source golfing pass — 2026-09-13

`npm run build:fast`, fixed Roadroller seed 13312, 10 advzip iterations.
Each candidate was built separately against the retained source at that point;
only strict size wins were retained. Source started clean. No build settings changed.

**Advzip: 13,320 → 13,301 bytes, saving 19 bytes; 11 bytes below 13,312.**
The final retained source was rebuilt to confirm the result.

## Retained changes

- Share the cargo count between the HUD label and capacity predicate; inline
  the single-use label. Preserve the full-hold sine flash, its clock and rate,
  and the alpha reset before drawing coordinates.
- Use the floodlight's existing 0.1-second activation fallback.
- Inline thruster activation progress and cache its twice-read palette colour.
- Select docked repair/remove actions with a ternary and spread the cargo Map
  into its ordered row array.

Old experiments were retried because the source and post-Terser syntax pass
have changed. In particular, removing floodlight duration previously cost 1 byte
and now saves 2; the docked action ternary previously cost 8 and now saves 4.
Several neutral candidates remained neutral; none were retained on that basis.
History consulted: [measured experiments](../.agents/skills/code-golfing/references/measured-experiments.md),
[fallback/canvas](../.agents/skills/code-golfing/references/fallback-and-canvas.md),
[shared animation/vectors](../.agents/skills/code-golfing/references/shared-animation-mining-and-vectors.md),
and [post-Terser changes](../.agents/skills/code-golfing/references/custom-replacement.md).

## Measurements

| Candidate | Before | After | Difference | Status |
| --- | ---: | ---: | ---: | --- |
| cargo-inline-label | 13320 | 13319 | -1 | Retained |
| cargo-flash-ternary | 13319 | 13322 | +3 | Reverted |
| cargo-flash-grouped | 13319 | 13347 | +28 | Reverted |
| cargo-shared-count | 13319 | 13314 | -5 | Retained |
| floodlight-default-duration-retry | 13314 | 13312 | -2 | Retained |
| keyboard-event-length-retry | 13312 | 13330 | +18 | Reverted |
| keyboard-callback-array-retry | 13312 | 13312 | +0 | Reverted |
| force-components-retry | 13312 | 13338 | +26 | Reverted |
| player-thrust-unary-retry | 13312 | 13312 | +0 | Reverted |
| thruster-inline-strength-retry | 13312 | 13309 | -3 | Retained |
| thruster-color-local-retry | 13309 | 13308 | -1 | Retained |
| cargo-cache-count-in-ui | 13308 | 13331 | +23 | Reverted |
| ui-context-local | 13308 | 13327 | +19 | Reverted |
| sprite-direct-context-retry | 13308 | 13308 | +0 | Reverted |
| docked-actions-ternary-retry | 13308 | 13304 | -4 | Retained |
| docked-flatmap-single-type | 13304 | 13305 | +1 | Reverted |
| docked-fused-hull-health | 13304 | 13308 | +4 | Reverted |
| docked-cargo-spread-map | 13304 | 13301 | -3 | Retained |
| mining-fracture-shared-health-guard | 13301 | 13326 | +25 | Reverted |
| docking-combine-asteroid-guard | 13301 | 13301 | +0 | Reverted |
| vector-normalize-shared-scale | 13301 | 13307 | +6 | Reverted |
| vector-distance-shared-subtract | 13301 | 13307 | +6 | Reverted |
| prism-chain-inside-colors | 13301 | 13301 | +0 | Reverted |
| shrapnel-inline-tail-retry | 13301 | 13325 | +24 | Reverted |
| camera-inline-half-dimensions-retry | 13301 | 13301 | +0 | Reverted |
| distribute-inline-overlap-retry | 13301 | 13301 | +0 | Reverted |
| inline-stow-retry | 13301 | 13325 | +24 | Reverted |
| docked-inline-action-locals | 13301 | 13301 | +0 | Reverted |
| cargo-inline-count-helper-retry | 13301 | 13337 | +36 | Reverted |

## Validation

- Collision, docked gameplay, prism and sound suites pass, including their
  production-mangled scenarios and 360 prism tracing/rendering frames.
- 540 original/current HUD comparisons match text, position, alignment, alpha
  at every draw and final alpha. Cases cover empty, partial, full and overfull
  holds; loose modules; zero capacity; docked/undocked states; messages; and
  six clock values including sine extrema and an epoch timestamp.
- 101 original/current thruster-glow canvas command comparisons match exactly
  across activation progress 0–1.
- Floodlight duration resolves through the same `part.activationDuration ||
  craftModule.activationDuration || 0.1` expression in `makeSegment`; no module
  or part override is added. The removed explicit value equals the fallback.
- Docked tests exercise damaged/intact fitted modules, purchase/equip/remove/sell,
  ore stacking, independent module instances and full cargo capacity.
- Packed-build Firefox smoke test: no runtime errors before or after trusted
  keyboard input; approximately 60 FPS, with audio context created only after
  input and measured nonzero audio output. This is a smoke test, not human
  listening or a pixel comparison.
- Lint and whitespace checks pass after correcting ternary indentation.

The differential harness and per-build logs are in `/tmp/last-golf/`.

## Shared thruster-glow layer follow-up

The first working layer fix measured 13,349 bytes. This follow-up simplifies
that fix to **13,315 bytes (-34)** with the same fast-build settings: three
bytes over the 13,312-byte limit. Compared with the 13,301-byte pre-fix build,
the corrected draw order now costs 14 bytes instead of 48.

Thruster glows reuse the beam renderer's existing segment traversal and
canvas transforms. A cached fractional-layer predicate selects the glow
pass, and one call dispatches to the glow, exterior-spectrum or inside-beam
renderer. The layer order remains flares (-1), all glows (-0.5), hulls (0).
The beam-lighting debug toggle still leaves thruster glows under their own
glow toggle. No outline, brightness, geometry or animation changes were made.

Each candidate below was measured separately; ties and losses were reverted.
Nearby previous candidates were retried because the rendering source changed.

| Candidate | Before | After | Difference | Status |
| --- | ---: | ---: | ---: | --- |
| share-beam-glow-pass | 13349 | 13327 | -22 | Retained |
| numeric-layer-loop | 13327 | 13351 | +24 | Reverted |
| fractional-layer-predicate | 13327 | 13324 | -3 | Retained |
| negative-light-layer-guard | 13324 | 13348 | +24 | Reverted |
| cache-glow-layer | 13324 | 13321 | -3 | Retained |
| glow-remove-nested-canvas-state | 13321 | 13347 | +26 | Reverted |
| spectrum-layer-order-compare | 13321 | 13327 | +6 | Reverted |
| negative-light-layer-remainder | 13321 | 13345 | +24 | Reverted |
| layer-array-foreach | 13321 | 13321 | +0 | Reverted |
| light-guard-reordering | 13321 | 13323 | +2 | Reverted |
| cached-explicit-glow-layer | 13321 | 13353 | +32 | Reverted |
| fold-light-layer-guard-into-segment | 13321 | 13345 | +24 | Reverted |
| light-inline-health-check | 13321 | 13328 | +7 | Reverted |
| render-inline-health-check | 13321 | 13348 | +27 | Reverted |
| cargo-flash-ternary-retry | 13321 | 13326 | +5 | Reverted |
| ui-context-local-retry | 13321 | 13348 | +27 | Reverted |
| glow-cache-strength-retry | 13321 | 13327 | +6 | Reverted |
| glow-inline-color-retry | 13321 | 13318 | -3 | Retained |
| docked-array-from-retry | 13318 | 13349 | +31 | Reverted |
| docked-flatmap-single-type-retry | 13318 | 13319 | +1 | Reverted |
| shared-light-render-call | 13318 | 13318 | +0 | Reverted |
| render-group-derived-state | 13318 | 13345 | +27 | Reverted |
| single-light-render-dispatch | 13318 | 13315 | -3 | Retained |
| docked-actions-filter-retry | 13315 | 13353 | +38 | Reverted |
| shared-spectrum-layer-comparison | 13315 | 13317 | +2 | Reverted |
| glow-light-dispatch-order | 13315 | 13316 | +1 | Reverted |
| glow-select-module-predicate-order | 13315 | 13315 | +0 | Reverted |
| cargo-inline-label-local-retry | 13315 | 13345 | +30 | Reverted |

The final build confirms 13,315 bytes. Collision, docked, prism and sound
suites pass. The docked suite includes the actual ship renderer for all four
engine layouts, two craft in either order, inactive/broken engines and balanced
canvas state, both before and after production property mangling. The prism
suite covers 360 traced/rendered frames and corner cases. Lint and whitespace
checks pass after correcting continuation indentation.

Packed Firefox smoke test also passes: no runtime errors before/after keyboard
input, approximately 59 FPS. This checks execution, not pixel equivalence.
