# Measured audio and collision experiments (2026-09-10)

Fresh baseline and final result use `npm run build:fast`, four Terser passes,
unchanged Roadroller parameters, and 10 advzip iterations. The tracked ZIP was
stale at the time; the measured baseline was a fresh build.

**13,417 → 13,270 bytes: 147 bytes saved, 42 bytes below 13,312.**

## Regression found after this pass: buffer must be filled before assignment

One of the retained candidates below (`direct-audio-buffer`) reordered
`sound.js` to `source.buffer = zzfxX.createBuffer(...)` first, then fill the
samples via `getChannelData()` afterwards. This saved 15 bytes and passed
every automated check at the time (Node test suite, headless Chromium,
Firefox "no runtime errors" spot-check) — but real Firefox played silence:
it appears to snapshot the still-all-zero buffer for its audio-rendering
thread at the moment `.buffer` is assigned, so the later writes to the
`Float32Array` never reach actual playback. No exception, no console output,
no tab audio icon.

Fixed (2026-09-10, after the drill shipped silently for a full session) by
filling `getChannelData()` completely first, then assigning the finished
buffer to `source.buffer` — the order the original "WIP sound implementation"
commit used before this golfing pass changed it. If this reorder is
retried for bytes in future, it must be re-verified as actually *audible* in
real Firefox, not just checked for thrown errors: an `AnalyserNode` hooked to
`ctx.destination` showing a nonzero peak in headless Chromium, and even a
real `AudioContext.state` of `running` logged from a real browser, both
failed to catch this — Chrome silently tolerates the reordering that Firefox
does not.

## Findings from the generated output

With `conditionals` disabled, the new sound code retained constant waveform
branches even though the drill uses only the pulse waveform. Restoring
conditional optimization removes those branches for this preset while
preserving all four waveform implementations in `sound.js` for future
callers. Limiting Terser inlining to level 1 then improves the final ZIP.
More compression passes, statement joining, and several formatting options
did not help.

Mutating attack/sustain/release arguments prevented useful folding of the
sound preset. Separate sample-count locals let the compiler reduce the fixed
envelope to constants. Samples are generated directly into the AudioBuffer
channel instead of copied from an intermediate array (but see the regression
above — direct generation is fine, generating into a buffer already assigned
to a source is not). Phase uses cycles and the sample index; zero-randomness
effects skip the random draw. The eight-argument API, 44,100 Hz sample rate,
5,292-sample drill duration, and four waveform choices remain. Pulse
transitions may shift by one sample due to the changed phase calculation;
this is not a bit-identical audio rewrite.

The duplicate item registry is removed. Item registration uses
`Sprite.add`/`remove`, and scoop checks `game.sprites` membership, preserving
duplicate-contact rejection. Segment updates read the module callback
directly. Collision detection inserts each object after testing existing
neighbors, eliminating the separate insertion pass and order fields while
preserving contact order.

The repeated item/engine data, gradient helpers, additional property
rewrites, and several shorter-looking formulas generally compressed worse.
Losses and ties were reverted.

## Validation

- Collision, prism, docked inventory/flight, and new sound suites pass; sound
  and docked scenarios also run through production preprocessing and property
  mangling.
- The new sound suite covers all four waveforms, randomized pitch, connected/
  started sources, and drill threshold/start/hold/stop/restart behavior.
  Shared Web Audio stubs allow existing gameplay tests to load the sound
  module in Node. **None of this catches the buffer-order regression above —
  the Node stub's `getChannelData` doesn't model a real audio thread, so a
  passing test suite does not prove the drill is actually audible.**
- Differential collision check: 2,036 ordered contacts match exactly across
  200 mixed polygon/circle scenes.
- Audio comparison: same duration/sample rate; smooth-wave differences below
  4e-9 in the sampled cases. Seven of 5,292 drill samples differ at pulse
  edges.
- Firefox: original and optimized builds both run at approximately 60 FPS
  after warm-up and while flying with hatch, drill, and light enabled. Actual
  `AudioContext` state is running; one looping source starts, stops once, and
  restarts as a new source. No runtime errors. (This check watched state and
  timing, not whether sound was actually heard — it missed the regression
  above entirely.)
- The generated decoder produces exactly the same program as the original
  Roadroller decoder. Roadroller normalizes JavaScript whitespace, so direct
  byte comparison against `minified.js` is not the appropriate decoder test.
- Lint and `git diff --check` pass.

## Measured candidates

67 completed trials. Results below are sequential, against the then-retained
state. A retained intermediate setting can be superseded by a later retained
change. All sizes are final advzip bytes.

| Candidate | Before | After | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| direct-audio-buffer | 13417 | 13402 | -15 | Retained, later found to break real playback in Firefox - see regression note above |
| sample-index-phase | 13402 | 13395 | -7 | Retained |
| normalized-wave-phase | 13395 | 13394 | -1 | Retained |
| nested-horn-sound-guard | 13394 | 13391 | -3 | Retained |
| horn-optional-stop | 13391 | 13417 | +26 | Reverted |
| sound-enable-conditionals | 13391 | 13360 | -31 | Retained |
| sound-enable-comparisons | 13360 | 13391 | +31 | Reverted |
| sound-enable-join-vars | 13360 | 13397 | +37 | Reverted |
| sound-enable-sequences | 13360 | 13458 | +98 | Reverted |
| sound-booleans-default | 13360 | 13374 | +14 | Reverted |
| sound-passes-5 | 13360 | 13360 | 0 | Reverted |
| sound-passes-6 | 13360 | 13360 | 0 | Reverted |
| sound-passes-8 | 13360 | 13360 | 0 | Reverted |
| sound-passes-12 | 13360 | 13360 | 0 | Reverted |
| audio-direct-buffer-property | 13360 | 13359 | -1 | Retained |
| audio-map-channel | 13359 | 13348 | -11 | Retained |
| audio-zero-randomness-guard | 13348 | 13334 | -14 | Retained |
| audio-duration-seconds | 13334 | 13340 | +6 | Reverted |
| audio-loop-parameter | 13334 | 13336 | +2 | Reverted |
| audio-context-sample-rate | 13334 | 13337 | +3 | Reverted |
| audio-48khz | 13334 | 13340 | +6 | Reverted |
| audio-predivide-envelope | 13334 | 13342 | +8 | Reverted |
| audio-sequences-2 | 13334 | 13477 | +143 | Reverted |
| audio-sequences-3 | 13334 | 13469 | +135 | Reverted |
| audio-sequences-5 | 13334 | 13439 | +105 | Reverted |
| audio-sequences-10 | 13334 | 13443 | +109 | Reverted |
| audio-inline-0 | 13334 | 13371 | +37 | Reverted |
| audio-inline-1 | 13334 | 13332 | -2 | Retained |
| audio-inline-2 | 13332 | 13334 | +2 | Reverted |
| audio-loop-step-expression | 13332 | 13328 | -4 | Retained |
| audio-immutable-envelope-parameters | 13328 | 13305 | -23 | Retained |
| audio-immutable-frequency | 13305 | 13306 | +1 | Reverted |
| audio-inline-default-again | 13305 | 13342 | +37 | Reverted |
| audio-no-sustain-local | 13305 | 13305 | 0 | Reverted |
| audio-randomness-default-zero | 13305 | 13385 | +80 | Reverted |
| data-fill-stroke-mangling | 13305 | 13331 | +26 | Reverted |
| audio-mangle-path | 13305 | 13314 | +9 | Reverted |
| audio-mangle-model | 13305 | 13328 | +23 | Reverted |
| audio-mangle-offset | 13305 | 13331 | +26 | Reverted |
| audio-mangle-red | 13305 | 13313 | +8 | Reverted |
| audio-mangle-image | 13305 | 13315 | +10 | Reverted |
| audio-mangle-size | 13305 | 13340 | +35 | Reverted |
| audio-mangle-unlock | 13305 | 13326 | +21 | Reverted |
| audio-mangle-face | 13305 | 13315 | +10 | Reverted |
| audio-unused-parameters | 13305 | 13305 | 0 | Reverted |
| audio-reduce-functions-off | 13305 | 13456 | +151 | Reverted |
| audio-unsafe-methods | 13305 | 13305 | 0 | Reverted |
| audio-unsafe-math-off | 13305 | 13305 | 0 | Reverted |
| audio-hoist-properties-off | 13305 | 13305 | 0 | Reverted |
| audio-collapse-vars-off | 13305 | 13341 | +36 | Reverted |
| audio-waveform-switch | 13305 | 13310 | +5 | Reverted |
| audio-waveform-table | 13305 | 13305 | 0 | Reverted |
| horn-after-shield | 13305 | 13327 | +22 | Reverted |
| horn-before-hatch | 13305 | 13315 | +10 | Reverted |
| sound-const-context-last | 13305 | 13305 | 0 | Reverted |
| remove-redundant-item-registry | 13305 | 13313 | +8 | Reverted |
| ship-module-update-direct | 13305 | 13304 | -1 | Retained |
| item-registry-use-sprites | 13304 | 13286 | -18 | Retained |
| collision-incremental-grid | 13286 | 13272 | -14 | Retained |
| collision-local-grid | 13272 | 13270 | -2 | Retained |
| audio-phase-expression | 13270 | 13279 | +9 | Reverted |
| audio-direct-envelope-times | 13270 | 13270 | 0 | Reverted |
| thruster-factory | 13270 | 13326 | +56 | Reverted |
| immutable-frequency-with-full-inline | 13270 | 13281 | +11 | Reverted |
| audio-envelope-seconds | 13270 | 13281 | +11 | Reverted |
| horn-start-loop-assignment | 13270 | 13276 | +6 | Reverted |
| horn-logical-assignment | 13270 | 13294 | +24 | Reverted |

### Lazy audio initialization

Defer `AudioContext` creation until the first `zzfx` call, after drill input,
and reuse it for later effects. Initialize its cache explicitly to zero:
leaving it undefined collided with a Roadroller decoder variable in the
packed browser build. Regression coverage checks no context on import or
inactive drill, and one shared context across effects. Advzip build:fast:
13270 -> 13275 bytes (+5).

This later needed revisiting too: creating/resuming the context from inside
`zzfx()` is still a rAF frame after the triggering keydown, which some
browsers (Firefox in particular) don't treat as "close enough" to the user
gesture to auto-resume. The context can end up permanently suspended with no
error. Fixed by exporting `unlockAudio()` from `sound.js` and calling it
unconditionally from `keyboard.js`'s `keyEventHandler` — the actual
`window.onkeydown`/`onkeyup` handler, i.e. the one place in the codebase that
runs synchronously inside a real trusted gesture. `resume` also needed adding
to `vite.config.js`'s `mangle.properties.reserved`, the same pitfall class as
the other Web Audio property names (see the main SKILL.md's property
mangling pitfalls section).
