# Cached sound buffers and shared target ramps (2026-09-13)

Final isolated `build:fast` comparison: **13,656 → 13,371 advzip bytes,
285 saved**, 59 above the entry limit. Fixed seed 13312, 10 advzip iterations.
The initial baseline was 13,651. Independent player changes landed during this
pass; rebuilding the original sound/horn/Vite files against the final surrounding
code gave 13,656. Those independent changes are preserved.

## Retained design

Cached loops replace live oscillators, PeriodicWave data, modulation gains and
BiquadFilter nodes. The drill retains its chopped 30 Hz triangle and levels.
The engine combines correlated low-pass noise with a quiet 24 Hz sine raised
to the seventh power for odd exhaust harmonics. Playback rate moves both the
motor pitch and air spectrum with load. All buffers use 44,100 Hz and are filled
before source assignment; this preserves Firefox playback.

One `setTargetAtTime` helper handles gain and engine pitch. It keeps a 10 ms lead,
40 ms engine attack, 300 ms engine release and 100 ms drill fades. Five exponential
time constants reach within 1% of the target before audio-clock stop. Fades are
now exponential, not linear. Cached targets prevent held-input rescheduling.

One-shots retain presets, sweeps, caching and cooldowns. Shield tones are now
sines. A shared attack/exponential-decay envelope replaces sustain/release, with
slight duration rounding. Noise uses a fixed one-pole cutoff instead of a sweep.
A positive playback-rate argument selects engines; default/zero selects drills.

Unused reservations are removed; `type` remains for KeyboardEvent.type.
`playbackRate` and `setTargetAtTime` are reserved. Removing unused reservations
alone was byte-neutral. `exponentialRampToValueAtTime` was already absent from
the original built JS; removing actual native API calls/graph nodes saved bytes.

## Validation

Sound and docked gameplay tests pass, including production mangling. Tests cover
finite/nonzero samples, silent effect starts, filled-before-assignment, cached
buffers, cooldowns, held input, load changes, fade scheduling and restart.
The stub records target ramps; it does not simulate the real audio thread.
Lint and diff whitespace checks pass.

Firefox baseline/source/production-mangled audio checks show nonzero onset,
held and release output, then zero after stop. Final held RMS: 0.01428 baseline,
0.01246 source, 0.01251 mangled. These short readings verify audible and similarly
quiet output, not human listening approval or identical timbre.

The packed-game check uncovered an existing startup-key mangling bug: keyboard
callbacks are written with computed keys, but the literal empty-string read was
mangled. Reserving `''` fixes launch and saves another 4 bytes (13,375 → 13,371).
A regression test binds the empty key and sends a keydown through the real
keyboard handler, before and after production mangling. Final packed Firefox
checks pass with trusted input: no context before input, one running context,
nonzero engine and drill output, no runtime errors. Engine peak 0.04957; drill
peak 0.30046. There is one source per voice, containing 44,100/1,470 samples.

## Exploratory measurements

Sequential build:fast results follow. Earlier retained steps can be superseded
by the final design. Concurrent changes make this an experiment history; use
the isolated final comparison above for the saving. Linear noise envelopes were
reverted to preserve loudness. The bounce endpoint was corrected to retain its
fixed pitch. Reading live frequency instead of cached targets was rejected
because it would reschedule an in-progress ramp on every frame.

```text
seconds-envelope: 13651 -> 13625, retained
shared-connection: 13625 -> 13633, reverted
drop-unused-lead-time: 13625 -> 13622, retained
noise-cutoff-discriminator: 13622 -> 13620, retained
preset-rounding: 13620 -> 13641, reverted
phase-cycles: 13620 -> 13617, retained
filter-rounded-ratio: 13617 -> 13613, retained
single-time-read: 13613 -> 13610, retained
default-end-frequency: 13610 -> 13605, retained
envelope-min: 13605 -> 13610, reverted
cooldown-slot: 13605 -> 13604, retained
constant-noise-filter: 13604 -> 13601, retained
sine-shields: 13601 -> 13611, reverted
drop-initial-pitch-events: 13601 -> 13592, retained
simplify-motor-mapping: 13592 -> 13617, reverted
remove-effect-guard: 13592 -> 13591, retained
cooldown-no-slide: 13591 -> 13618, reverted
shared-routing: 13591 -> 13585, retained
millisecond-presets: 13585 -> 13587, reverted
combined-waveform-cutoff: 13585 -> 13612, reverted
zero-imaginary-spectrum: 13585 -> 13622, reverted
fixed-bounce endpoint: 13585 -> 13587, retained (required behavior preservation)
envelope-linear-noise: 13587 -> 13577, retained
envelope-linear-min: 13577 -> 13579, reverted
inline-effect-frequency: 13577 -> 13576, retained
map-effect-samples: 13576 -> 13574, retained
map-noise-samples: 13574 -> 13601, reverted
shared-default-duration: 13574 -> 13574, reverted
stop-closure-no-bind: 13574 -> 13572, retained
shared-depth-gain: 13572 -> 13581, reverted
direct-filter-sample: 13572 -> 13566, retained
restore-noise-decay: 13566 -> 13582, retained (preserve loudness)
sine-shields-remove-shape-slot: 13582 -> 13562, retained
string-presets: 13562 -> 13607, reverted
single-envelope-decay: 13562 -> 13552, retained
single-envelope-total-duration: 13552 -> 13555, reverted
noise-filter-unconditional: 13552 -> 13546, retained
single-decay-preset-slot: 13546 -> 13537, retained
native-stop-at-callsite: 13537 -> 13552, reverted
drop-engine-default: 13537 -> 13542, reverted
linear-revs: 13537 -> 13536, retained
rounded-noise-coefficient: 13536 -> 13535, retained
rounded-depth: 13535 -> 13533, retained
rounded-hatch-attack: 13533 -> 13535, reverted
rounded-ui-attack: 13533 -> 13535, reverted
rounded-small-attack: 13533 -> 13534, reverted
filter-coefficient-local: 13533 -> 13544, reverted
shared-buffer-generation: 13533 -> 13515, retained
shared-audio-ready: 13515 -> 13560, reverted
shorter-noise-arithmetic: 13515 -> 13513, retained
effect-phase-direct: 13513 -> 13515, reverted
remove-duplicate-load-clamp: 13513 -> 13536, reverted
reduce-active-thrusters: 13513 -> 13513, reverted
remove-unused-drill-args: 13513 -> 13514, reverted
fixed-sample-rate: 13513 -> 13512, retained
attack-min-envelope: 13512 -> 13509, retained
default-frequency-delta: 13509 -> 13532, reverted
rounded-decay: 13509 -> 13507, retained
repeated-spectrum: 13507 -> 13514, reverted
start-sources-map: 13507 -> 13543, reverted
shared-pitch-parameter: 13507 -> 13514, reverted
engine-frequency-cache-value: 13507 -> 13508, reverted
rounded-tau: 13507 -> 13513, reverted
undefined-stopped-voice: 13507 -> 13509, reverted
truthy-engine-power: 13507 -> 13509, reverted
preset-centiseconds: 13507 -> 13531, reverted
incremental-pitch: 13507 -> 13515, reverted
no-effect-length-truncation: 13507 -> 13509, reverted
sample-random-centered: 13507 -> 13510, reverted
loop-buffer-for: 13507 -> 13514, reverted
single-sample-volume: 13507 -> 13538, reverted
baked-engine: 13507 -> 13552, superseded by shared buffered drill
baked-drill: 13552 -> 13507, retained
drill-direct-output: 13507 -> 13530, reverted
baked-native-stop: 13507 -> 13489, retained
single-exhaust-pulse: 13489 -> 13505, reverted
baked-filter: 13489 -> 13496, reverted
remove-live-filter-node: 13489 -> 13470, retained
quieter-baked-motor: 13470 -> 13446, retained
playback-rate-in-caller: 13446 -> 13441, retained
exponential-target-fades: 13441 -> 13420, retained
shared-target-ramp: 13420 -> 13408, retained
tone-output-helper: 13408 -> 13412, reverted
default-engine-rate: 13408 -> 13408, reverted
common-continuous-duration: 13408 -> 13432, reverted
one-cycle-drill: 13408 -> 13408, reverted
clamp-revs-inline: 13408 -> 13408, reverted
odd-harmonic-engine: 13408 -> 13393, retained
analytic-effect-phase: 13393 -> 13415, reverted
effect-cache-slots: 13393 -> 13410, reverted
engine-initial-gain-order: 13393 -> 13418, reverted
triangle-pulse-expanded: 13393 -> 13389, retained
shared-continuous-buffer-assignment: 13389 -> 13391, reverted
shared-loop-cache: 13389 -> 13386, retained
trim-unused-reserved-properties: 13386 -> 13386, retained (configuration cleanup)
playback-rate-selects-engine: 13386 -> 13377, retained
waveform-by-frequency: 13377 -> 13377, reverted
filter-falsy-default: 13377 -> 13379, reverted
phase-hertz-samples: 13377 -> 13379, reverted
shared-time-unit: 13377 -> 13379, reverted
filter-decay-coefficient: 13377 -> 13379, reverted
zero-playback-rate-default: 13377 -> 13383, reverted
no-level-early-return: 13377 -> 13379, reverted
effect-length-buffer-samples: 13377 -> 13401, reverted
engine-simple-revs: 13377 -> 13376, retained
final engine level balance: 13376 -> 13375, retained
```
