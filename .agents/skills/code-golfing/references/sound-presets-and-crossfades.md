# Sound preset and crossfade optimization experiments

Fresh build:fast advzip baseline: **13,585 bytes**. Final: **13,504 bytes**,
**81 bytes saved**, still **192 bytes over** the 13,312-byte limit.

Retained source changes, confirmed by a sequential rebuild of each stage:

| Change | Before | After | Saving |
| --- | ---: | ---: | ---: |
| Share idle/loaded sound call; vary only volume and frequency | 13585 | 13513 | 72 |
| Cache the gain AudioParam | 13513 | 13509 | 4 |
| Schedule native stop on the audio clock at fade completion | 13509 | 13504 | 5 |

The context still unlocks synchronously in keyboard input. The completed buffer
is still assigned only after sample generation. Presets, debounce, crossfade
lengths and waveform calculations are unchanged. Native stop uses audio time,
so suspension or main-thread delays no longer make a wall-clock timer truncate
the fade. The nine-argument synthesizer API remains available for future effects.

The ZIP entry now has a fixed timestamp for reproducible archives. Turning off
streamFiles was neutral on isolated remeasurement and was reverted.

## Validation

- Sound suite passes with production preprocessing and Terser mangling. Added
  assignment-time sample snapshots to catch the prior all-zero-buffer regression,
  native fade-end stop scheduling, brief contact flicker and settled biting tests.
- Collision, docked gameplay and prism suites pass.
- Packed baseline and final run in Firefox with trusted D key input: no contexts
  before input, one running context afterward, identical 1,323-sample idle buffers,
  nonzero analyser output (peak 0.06669969), zero output after stopping, no errors.
  Measured performance was comparable (baseline 57.6, optimized 58.5 FPS).
  This measures audio output; it is not a claim of human listening verification.
- Lint and diff whitespace checks pass.

## Exploratory measurements

The table records raw exploratory runs. Some before-size readings were taken
from dist after other checks had run, so only the isolated sequence above is
used for final savings. Losers and ties were reverted; no Terser changes remain.

| Candidate | Before reading | After build | Decision |
| --- | ---: | ---: | --- |
| shared-preset | 13585 | 13513 | Retained |
| gain-param-local | 13513 | 13509 | Retained |
| terser-inline-0 | 13509 | 13533 | Reverted |
| terser-inline-2 | 13509 | 13543 | Reverted |
| terser-inline-3 | 13509 | 13543 | Reverted |
| terser-join_vars-true | 13509 | 13551 | Reverted |
| terser-comparisons-true | 13509 | 13523 | Reverted |
| terser-sequences-true | 13538 | 13601 | Reverted |
| terser-booleans_as_integers-false | 13509 | 13553 | Reverted |
| native-scheduled-stop | 13517 | 13504 | Retained |
| chain-audio-connect | 13504 | 13504 | Reverted |
| chain-gain-ramp | 13504 | 13507 | Reverted |
| chain-gain-release | 13504 | 13507 | Reverted |
| horn-counter-init | 13504 | 13512 | Reverted |
| new-terser-sequences-2 | 13504 | 13668 | Reverted |
| new-terser-sequences-5 | 13504 | 13611 | Reverted |
| new-terser-sequences-20 | 13504 | 13589 | Reverted |
| new-terser-conditionals-false | 13504 | 13552 | Reverted |
| terser-keep_fargs: false | 13500 | 13504 | Reverted |
| terser-arrows: false | 13504 | 13504 | Reverted |
| terser-reduce_funcs: false | 13504 | 13633 | Reverted |
| terser-hoist_funs: true | 13504 | 13558 | Reverted |
| terser-hoist_vars: true | 13504 | 14008 | Reverted |
| terser-unsafe_methods: true | 13504 | 13504 | Reverted |
| terser-evaluate: false | 13504 | 13923 | Reverted |
| terser-collapse_vars: false | 13504 | 13547 | Reverted |
| terser-reduce_vars: false | 13504 | 13988 | Reverted |
| zip-no-descriptor | 13542 | 13504 | Reverted |
| sound-release-call | 13504 | 13523 | Reverted |
| triangle-remainder | 13504 | 13526 | Reverted |
| horn-shared-stop | 13504 | 13515 | Reverted |

## Single-source drill, short crossfade (2026-09-10, later pass)

Baseline **13,452 bytes** (build:fast). Final **13,434 bytes**, **18 saved**.

| Candidate | Before | After | Decision |
| --- | ---: | ---: | --- |
| one-source-gain-ramp (delete second preset, delete debounce, delete `fadeTime` param, `fadeTime` 0.5 -> 0.1) | 13452 | 13434 | Retained |
| delete-sustain-param | 13434 | 13434 | Reverted (byte-identical) |

The drill now starts one silent looping source and only ramps its gain between
`0.3` and `1` as `segment.biting` changes, via a shared `fade(sound, level)`
export that cancels, re-anchors and `linearRampToValueAtTime`s over `0.1`s, and
returns the ramp end time for `stop()` to schedule the native stop on. Nothing
restarts, so the edge-contact debounce, `wasBiting`/`bitingFor`/`wasChecked`
state and the second preset were all deleted; contact flicker simply retargets
an in-flight ramp. The idle/biting change is now heard in a tenth of a second
rather than a half, which is what made it too subtle before.

**Unused zzfx parameters and wave shapes are free.** Terser inlines `zzfx` into
`horn.update` (one call site, all-literal arguments) and constant-folds it down
to the triangle branch with the preset's numbers baked in, so removing the
`sustain` parameter produced a byte-identical ZIP. Golf the call-site preset or
the buffer math instead; check `dist/minified.js` around `createBufferSource`
before pricing any further parameter deletion.
