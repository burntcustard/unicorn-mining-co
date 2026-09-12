## Cached sound buffers and shared target ramps (2026-09-13)

[Buffer golfing pass](sound-buffer-golf.md): **13,656 → 13,371 bytes, 285 saved**.
Replaces oscillators, periodic waves and live filters with cached loops, and
shares target ramps. Includes sound changes, checks and candidate measurements.

# Sound preset and crossfade optimization experiments

## Restore air and exhaust texture (2026-09-12)

User listening feedback rejected the preceding pitch-modulated turbine as
bleepy, synthetic and overly smooth, and explicitly required audible air.
Restore the quiet noise-to-filter-to-output route alongside the motor.
Noise sample amplitude is 0.08, versus 0.22 in the earlier too-loud air
version. Both sources share the 180–600 Hz low-pass filter. The motor returns
to a rounded, uneven exhaust spectrum: approximate first eight harmonics
of the earlier pulse model plus its 16th harmonic for additional texture.
This uses fixed integer coefficients and a cached PeriodicWave, not the
rejected runtime harmonic generator. Restore 6–10 Hz cycle rate, 0.17 motor
gain and 0.09–0.15 master gain (effective motor gain up to 0.0255). Onset,
release and drill behavior are unchanged.

Same `build:fast` settings: **13,502 -> 13,513 bytes**, **11 added**, retained
for the requested sound correction. Sound tests pass with production
mangling, verifying audible noise routing, shared low-pass filtering,
effective motor gain and firing harmonics. Changed files pass lint; full
lint still has the same four existing build-plugin errors. Diff check passes.
Firefox source/mangled checks confirm nonzero onset, hold and release,
then zero after stop. Short held RMS readings were 0.01360 before, 0.01231
source and 0.01189 mangled; not a calibrated loudness or listening assessment.

## Smaller Krait-inspired normal thrust (2026-09-12)

User rejected the preceding 101-byte increase, wanted quieter air, then
steered further toward Elite Dangerous's ordinary Krait/Krait Phantom
engines, explicitly excluding boost. References supplied by the user:

- [Krait, 0:26](https://www.youtube.com/watch?v=HpQMsXn5zYk&t=26s)
- [Krait Phantom, 28:43](https://www.youtube.com/watch?v=UKGR2FLUqJw&t=1723s)
- [Matthew Florianz's Elite design notes](https://www.matthewflorianz.com/audio/matthewflorianz_projects_elitedangerous.html)
  describe the game's worn, organic/mechanical aesthetic; those written
  notes chiefly discuss interfaces and are not a recipe for Krait engines.

Final `npm run build:fast`, same seed/settings: **13,604 -> 13,502 bytes**,
**102 saved**. This recovers the entire rejected 101-byte increase and is
1 byte smaller than the pre-research 13,503-byte version.

The final motor has a fixed normalized spectrum with sine coefficients
`[0,2,8,2,1,3,0,0,0,0,0,1]`, zero cosine coefficients, and an 18–30 Hz
fundamental. A stronger second harmonic supplies the low body; quieter
third/fifth/eleventh harmonics add mechanical character. There is no runtime
cylinder/harmonic generator. Noise now goes through its filter into the
motor's frequency AudioParam, producing gentle pitch variation instead of
an independently audible air layer. Noise sample amplitude 8 is in Hz on
this path, not an output volume. Removed the extra motor gain stage and
adjusted master gain to 0.015–0.025, preserving approximately the previous
effective level. Onset remains 10 ms lead + 40 ms gain attack, with 350 ms
pitch/texture rise and 300 ms release. Drill behavior remains unchanged.

Also removed main.js's dead hatchUnlock call: that preset does not exist,
so the call always returned silently. Working hatchOpen/hatchClose effects
remain in cargo-scoop.js.

Measurements below are sequential exploratory builds; superseded steps
are included to distinguish the final result from intermediate readings.
All used build:fast, seed 13312 and 10 advzip iterations.

| Candidate | Before | After | Decision |
| --- | ---: | ---: | --- |
| Fixed nine-harmonic approximation + air 0.22 -> 0.15 | 13604 | 13537 | Superseded by final spectrum |
| Unconditional pulse starts/stops | 13537 | 13560 | Retained only with shared construction below |
| Shared pulse/depth construction | 13560 | 13528 | Retained together, 9 saved vs fixed-wave stage |
| Map typed-array construction | 13528 | 13555 | Reverted |
| Sine-only rounded spectrum | 13528 | 13527 | Superseded by final spectrum |
| Algebraic pitch mapping | 13527 | 13529 | Reverted |
| Common depth-gain initialization/connection | 13529 | 13550 | Reverted |
| Integer coefficients, exploratory combined state | 13550 | 13524 | Superseded by isolated measurement |
| Integer coefficients, without losing mapping/depth changes | 13527 | 13526 | Retained |
| Plain coefficient arrays | 13526 | 13515 | Retained |
| Wave/noise initialization under one cache guard | 13515 | 13514 | Retained |
| Motor gain 0.22 -> 0.2 | 13514 | 13512 | Superseded for level balancing |
| Quieter air, smooth turbine spectrum and lower effective gain | 13512 | 13509 | Superseded after Krait references |
| Remove waveform cache | 13509 | 13542 | Reverted |
| Noise to pitch modulation, quiet upper harmonic, remove motor gain stage | 13509 | 13511 | Retained for requested character |
| Delete dead hatchUnlock call | 13511 | 13502 | Retained |

Plain arrays are supported by the standard's sequence<float> parameters:
[Web Audio createPeriodicWave](https://www.w3.org/TR/webaudio-1.0/#dom-baseaudiocontext-createperiodicwave).
Firefox verified them with real source and production-mangled playback.

Validation: sound and docked gameplay suites pass, including production
property mangling. Sound checks cover noise-to-frequency routing, direct
motor-to-envelope routing, preset onset, hold/restart, cache reuse and fade
timing. Changed files pass lint; full lint still reports only the four
existing build-plugin formatting errors. Real-time Firefox checks found
nonzero onset/held/release output and zero after stopping. Held RMS was
0.01452 for the expensive baseline, 0.01344 for final source and 0.01339 for
mangled source; these are short non-phase-aligned samples, not calibrated
perceived-loudness measurements.

Reference limitation: the YouTube pages loaded and analyser capture worked,
but playback repeatedly paused. Only short portions around 26–28 seconds
and 28:43–28:45 were obtained. Those samples had substantial low-frequency
energy and quieter upper tonal content, but do not establish the complete
normal-throttle ramp or a listening-verified match. The final sound is an
inspired approximation; no reference recordings are included in the game.

## Research-informed engine pulses (2026-09-12)

User requested research into appealing car-engine sounds and a subtle
application to the thruster. Primary references:

- [Doerfler and Wyse, pulse-train synthesis](https://arxiv.org/html/2603.09391v1):
  exhaust pressure pulses, firing-pattern phase relationships, harmonic
  attenuation and exhaust resonances. A synthesis preprint, not universal
  evidence of listener preference.
- [Kim et al., SAE 2017-01-1756](https://saemobilus.sae.org/articles/a-systematic-approach-engine-sound-design-enhancing-sound-character-active-sound-design-2017-01-1756):
  abstract discusses subjective assessment of acceleration envelopes and
  harmonic-order balance for powerful/pleasant sound.

Replace the plain motor sawtooth with a cached PeriodicWave constructed
from eight equally spaced firings, weighted 1/0.6 by bank using the pattern
1,5,4,8,6,3,7,2. The 32 harmonics decay by 0.8 per harmonic, rounding the
pulses. Bank imbalance introduces slower components without making global
firing intervals uneven. Cycle rate 6–10 Hz gives 48–80 firings per second;
this is a stylized exhaust contribution, not an engine physics simulation.
Keep noise, filter sweep, gains, attack/release and drill unchanged.
Reserve createPeriodicWave/setPeriodicWave against production mangling.

Same `build:fast` settings: **13,503 -> 13,604 bytes**, **101 added**, retained
for requested sound design. Sound tests pass with production mangling,
checking zero DC coefficient, firing harmonic, bank-imbalance components,
waveform reuse and existing start/stop behavior. Changed files pass lint;
full lint still has four existing build-plugin formatting errors.

Real-time Firefox source/mangled checks with trusted keyboard activation:
nonzero output at 50 ms, while held and during release, then zero after
release. Measured held RMS baseline 0.01676, candidate 0.01509, mangled
0.01457; these short, non-phase-aligned samples support no apparent level
increase, not a calibrated perceived-loudness comparison or human listening
judgment. Source buffer still fills before assignment.

## Darker, quieter engine tuning (2026-09-12)

User found both layers too high-pitched, the whoosh too loud and the motor
slightly too loud, requesting a deeper old-V8 character. Retained noise
amplitude 0.7 -> 0.22 (69% reduction), shared low-pass sweep 350–1800 Hz ->
180–600 Hz, motor sweep 32–64 Hz -> 22–38 Hz, and motor gain 0.25 -> 0.22
(12% reduction). Timings, master gain and drill stay unchanged. This tunes
the existing synthesis toward that character; it is not a verified V8 match.

Same `build:fast` settings: **13,504 -> 13,503 bytes**, **1 saved**.
Sound suite passes including production mangling and updated frequency
targets. Diff whitespace checks pass. Full lint has the same four existing
build-plugin formatting errors. No new browser check for these numeric changes.

## Thruster motor/whoosh blend (2026-09-12)

User requested a midpoint between the motor and noise versions, at about
half the volume. Retained a sawtooth motor at 32–64 Hz mixed through the
noise's existing low-pass filter. Noise samples use 0.7 amplitude and the
motor uses 0.25 gain, giving comparable contributions when the filter opens
without reintroducing the deep chopping. Both sources share the master
gain and audio-clock stop. Master gain is halved from 0.18–0.3 to 0.09–0.15;
the 350 ms filter rise, 40 ms gain attack and 300 ms release stay unchanged.
The drill is unchanged.

`build:fast`, same fixed settings: **13,454 -> 13,504 bytes**, **50 added**,
retained for the requested sound character. Sound tests pass with production
mangling, including motor pitch, half master gain, shared stop timing and
noise-buffer reuse. Diff whitespace checks pass; lint reports only the four
existing build-plugin formatting errors. The mix is approximate and has
not been assessed by human listening in this pass.

## Thruster whoosh revision (2026-09-12)

User listening feedback: the chopped sawtooth sounded like a burbling
motorbike, with too much spool-up and release time. Replace it with a
single looping white-noise source through a low-pass filter, retaining the
shared continuous handler and the drill's oscillator graph and start order.
The cached one-second noise buffer is filled before assignment to the source.
No amplitude modulation remains in the thruster. Cutoff opens from 350 Hz
to 1800 Hz over 350 ms; gain retains its 10 ms lead and 40 ms attack.
Release closes the filter and fades gain over 300 ms, down from 450 ms.

`npm run build:fast`, fixed settings: **13,471 -> 13,454 bytes**, **17 saved**.
The initial candidate was 13,452 bytes; restoring the drill's original
carrier-before-pulse start order cost 2 bytes and is retained.
Sound tests pass including production mangling, populated-buffer assignment,
buffer reuse, held-input automation, new filter targets and release timings.
Real-time Firefox source and mangled checks found nonzero output after
50 ms, while held and during release, then exactly zero after release.
Full lint reports only the four existing build-plugin formatting errors.
Audible output measurements do not assess the subjective sound character.

## Shared continuous motors and used presets (2026-09-12)

Fresh `npm run build:fast` baseline: **13,645 bytes**. Final: **13,471 bytes**,
**174 saved**, still **159 over** the entry limit. Same fixed Roadroller seed,
fast Terser settings and 10 advzip iterations throughout.

| Candidate | Before | After | Decision |
| --- | ---: | ---: | --- |
| Shared continuous handler; replace thruster noise bed with filtered sawtooth motor | 13645 | 13586 | Retained, authorized engine sound redesign |
| Remove redundant inactive guard in shared handler | 13586 | 13557 | Retained |
| Keep only used preset parameters and waveforms | 13557 | 13471 | Retained |

The drill keeps its 30 Hz chopped triangle, 0.08/0.2 gains, activation
threshold and 100 ms ramps with 100 ms lead. Both motors now store the last
requested level on their voice and share start/update/stop handling. The
engine uses a filtered sawtooth with half-frequency amplitude modulation,
32–64 Hz carrier and a cutoff following pitch. Any positive thrust gets a
10 ms lead plus 40 ms attack, pitch rises over 600 ms, and release lowers
pitch and fades over 450 ms before both oscillators stop. One voice still
serves all the player's thruster nozzles. Noise buffer creation and its
separate source/filter/gain lifecycle are gone.

The effect arrays now contain volume, frequency, attack, sustain, release,
waveform and optional cutoff. Removed unused randomness, slide, alternate
array layout and unused pulse/saw waveform synthesis. All nine current
presets retain their sound: deterministic-random before/after comparison
found identical sample counts and zero sample difference for every effect.
Buffers are still filled before source assignment.

Sound tests pass before and after production property mangling, including
tiny thrust, held input, power changes, release timing and rapid restart.
Docked gameplay tests pass. Changed files pass lint; full lint still reports
four pre-existing formatting errors in `plugins/vite-js13k.js`.
Real-time Firefox checks with trusted keyboard activation pass for source
and production-mangled audio: nonzero analyser output at 50 ms, while held,
and during release; exactly zero after release. Firefox's offline context
lacked `suspend`, so the initial offline timing check was replaced with
these real-time measurements.

This is a synthesized industrial engine interpretation; automated audio
measurements are not human listening approval or a claim of matching Elite
Dangerous's sound design.

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
