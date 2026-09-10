# Shared animation, mining and vector experiments

Continuation after the sound preset/crossfade pass. Measured with build:fast,
fixed Roadroller options and 10 advzip iterations.

**13,504 -> 13,452 bytes: 52 bytes saved; 140 bytes over the limit.**
Both endpoints were rebuilt from their corresponding sources at the end.

## Retained changes

- Initialize animation phase in makeSegment, removing identical state factories
  from the drill and shield. Each segment still owns its independent phase.
- Use the current biting list to deduplicate mining drills. Keep the selected
  contact record on the target instead of copying it to five separate fields.
  Preserve a snapshot of the tip coordinates before physics resolution; clear
  the record after damage so it cannot be applied twice.
- Reuse rotatePoint in rotatePoints and movePoint in world distribution.
  This favors the existing arithmetic helpers and call patterns. Floating-point
  evaluation grouping changes very slightly; random draws and order do not.
- Merge the three identical asteroid spike guards into one object spread.

The source changes are judged by packed ZIP size, not source length. Most
larger rewrites below reduced JavaScript characters but made the ZIP larger.
The retained changes also interact through Terser naming and compression, so
intermediate savings should not be added to predict a different combination.

## Outline renderer constraint

The wide-stroke experiment replaced 16 translated copies with one widened
stroke using round joins/caps. It was not visually equivalent at corners and
line ends. It was reverted when the user clarified that any outline change
must first be explained. The final renderer is byte-for-byte identical to the
one at the start of the pass. Do not change it without explaining the exact
proposal to the user first.

## Measurements

These are sequential exploratory builds, including a temporary outline change
that was subsequently reverted. Ties and losses were reverted.

| Candidate | Before | After | Decision |
| --- | ---: | ---: | --- |
| palette-strings | 13504 | 13516 | Reverted |
| outline-wide-stroke | 13504 | 13493 | Reverted |
| svg-polygon-path | 13493 | 13522 | Reverted |
| svg-line-paths | 13493 | 13495 | Reverted |
| strip-via-polygon-path | 13493 | 13509 | Reverted |
| merge-spike-options | 13493 | 13486 | Retained |
| linear-grid-neighbors | 13486 | 13489 | Reverted |
| rotate-points-shared-math | 13486 | 13483 | Retained |
| vector-force-component-update | 13483 | 13483 | Reverted |
| vector-move-component-update | 13483 | 13505 | Reverted |
| distribute-vector-helper | 13483 | 13475 | Retained |
| indexed-hull-mesh | 13475 | 13533 | Reverted |
| docked-local-text-renderer | 13475 | 13486 | Reverted |
| reuse-biting-list | 13475 | 13472 | Retained |
| mining-contact-record | 13472 | 13458 | Retained |
| Shared Math imports: twelve functions | 13504 | 13616 | Reverted |
| Shared Math imports: cos/sin/hypot | 13504 | 13567 | Reverted |
| Shared Math imports: abs/max/min | 13504 | 13601 | Reverted |
| Sprite inherits vector storage and operations | 13504 | 13506 | Reverted |
| Thruster specification rows with shared constructor | 13493 | 13511 | Reverted |
| Central segment phase initialization, after restoring outline | 13489 | 13452 | Retained |
| Standardize drawing on existing circlePath/shapePath helpers | 13452 | 13489 | Reverted |

The shared drawing trial covered thruster halos, craft movement circles,
shrapnel, docked UI slashes/separators and indicator triangles. It kept the
outline function intact. The palette, SVG-path and indexed-mesh trials did not
survive compression either.

## Validation

- Collision, docked gameplay, prism and sound suites pass. Docked gameplay and
  sound scenarios also exercise production preprocessing/property mangling.
- Added mining checks: deepest contact wins, duplicate contacts do not multiply
  damage, tip coordinates remain captured before movement, damage applies once,
  and lost contact clears the biting input used by sound.
- Three generated worlds (seeds 1, 8, 12345) retain identical object structures,
  strings and nonnumeric data across 213,665 numeric comparisons. Maximum numeric
  difference is 1.46e-11, from regrouped floating-point arithmetic.
- Firefox packed-build comparison: no AudioContext before input, one running
  context after trusted D input, identical 1,323-sample idle audio buffers,
  nonzero analyser peak 0.06669969, silence after switching off, no runtime errors.
  Optimized build measured 60.0 FPS after warm-up (baseline sample 57.2 FPS).
  This verifies measured audio output, not human listening.
- Original outline source equality, lint and git diff whitespace checks pass.
