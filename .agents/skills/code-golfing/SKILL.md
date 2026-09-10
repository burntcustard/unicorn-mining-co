---
name: code-golfing
description: Shrink Unicorn Mining Co.'s built ZIP. Use when optimizing, minifying or code-golfing existing code, and read the measured experiments before trying an idea that has already been tried.
---

# Code golfing

Size is judged by the built ZIP and nothing else. Read the measured experiments
linked below before spending a build on an idea somebody has already priced.

For per-file size analysis and tool inner workings, see the
[build-size-analysis](../build-size-analysis/SKILL.md) skill.

## How to measure

- Roadroller compresses repeated code well, so fewer source characters do not
  guarantee a smaller entry. Only the ZIP settles it.
- Record a baseline with the same build command before editing, and compare
  after. All builds pass Roadroller the fixed seed `13312`, so sizes compare
  directly when source inputs, dependencies and settings also match.
- Change one thing at a time and build between each, or the numbers mean
  nothing.
- `npm run build:fast` for any change while iterating, structural or
  single-line. It uses 10 advzip iterations, quick enough for rapid iteration
  while still reflecting real recompression.
  Do not use `build:full` while iterating: it has far more Terser passes, is too
  slow, and its absolute size is not the number to chase.
- For size results, report the before/after advzip sizes and the difference.
  Record the candidate, settings, retained/reverted status and behavior checks.
  Distinguish size wins from changes accepted for appearance or gameplay.
- When resuming interrupted work, inspect the working diff and latest notes.
  Preserve existing edits, establish a fresh baseline, and do not assume the
  generated ZIP matches the source. Revert only your unsuccessful candidate.
- Retry a recorded loss only when changed source, settings or a distinct
  hypothesis justifies it; otherwise move to another candidate. Record a
  measured result and clear status before ending the run. `build:search` runs
  indefinitely and requires an explicit user request.
- Preserve behavior unless the user authorizes changing it. Run relevant checks;
  existing tests passing alone does not prove equivalence. Documentation-only
  changes need no build.
- Run `npm run lint` afterwards, reporting it only if it fails. Braces, spacing
  and line breaks do not affect minified size; semantic lint fixes can.

## Property mangling pitfalls

`vite.config.js` mangles every property name Terser can find (`mangle:
{ properties: {} }`), and it renames literal property access consistently
wherever that literal appears — `obj.foo` and `obj['foo']` are the same
literal as far as the mangler is concerned. It cannot follow a value through
a variable, so `obj[someVariable]` is left completely alone.

This breaks any object that is written with a computed key in one place and
read with a literal key in another: the write stays under its real runtime
string, the literal read gets renamed to something else, and the lookup
always misses. This is exactly what happened when `player.js` read
`downKeys.Up`/`.ht`/`.ft` (literal) while `keyboard.js` wrote `downKeys[key]`
with `key` computed from `event.key.slice(-2)` — arrow keys and thrusters
went dead in every real build, but worked fine under `vite serve` since dev
never runs Terser. Fixed by adding those exact names to
`terserOptions.mangle.properties.reserved` in `vite.config.js`.

If you add a new computed-key lookup table (keyboard, item-name maps, etc.),
add every literal read site's key names to that `reserved` list, and verify
by grepping the built `dist/minified.js` for the mangled object's dynamic
write (e.g. `It[e]=`) against its dot-reads (e.g. `It.Up`) to confirm the
names actually match — don't trust lint or a dev-server smoke test for this
class of bug, since it only appears after a real Terser build.

A sibling pitfall hit `sound.js`: assigning an `AudioBuffer` to a
`source.buffer` before filling its `getChannelData()` samples compressed 15
bytes smaller and passed every automated/Node check, but played silence in
real Firefox with no error. Web Audio buffer-timing bugs are invisible to
automated and headless-Chromium testing the same way property mangling bugs
are invisible to dev-server testing — see
[Audio and collision experiments](references/audio-and-collision.md)
for the full story before reordering buffer fill vs. buffer assignment again.

## Areas to avoid

- Do not try to code-golf scripts/world-preview.js, src/benchmark.js, or any code
  which is locked behind the DEBUG or BENCHMARK flags as that code is not
  included in the ZIP, and is only for development and testing.
- The textjs glyphs have already been heavily optimized and are not worth further
  golfing attempts unless it is specifically requested for.
- Try to avoid moving code into main.js unless it makes a significant difference,
  as we are trying to keep that file in particular as readable as possible.

## What tends to work

- Deleting something outright. Removing an unused property, argument or return
  value often beats restructuring an expression, but still measure it.
- Inline a simple local that only feeds one or two calls, especially a value
  passed directly into a render helper. Measure it: a local that caches a long
  expression or serves several sites can still compress better.
- Truthy checks and omitted properties, rather than setting or comparing `null`
  or `undefined` where falsy values have no distinct meaning.
- Test helpers for substantial repeated blocks. Exact repeated text can
  compress better than a helper; similar blocks can benefit from sharing.
- Boolean state written as `true` or `false`, left for Terser to shorten. Keep
  numbers for levels and counters, and falsy sentinels for values that otherwise
  hold objects.
- Checking whether a guard is already redundant, in that the general case
  produces the same result without it.
- Reusing the idioms the codebase already uses elsewhere, which give Roadroller
  matching context. A bare `for` loop is novel text next to a `map` or
  `forEach`, and usually costs more than the callback argument it saves.
- Repeating an identical expression, rather than hoisting it into a local, is
  often free or cheaper — but not always (see the owned-module row swatch),
  so measure both ways when the expression appears twice.

## What tends not to work

- Shortening names of variables, properties or functions. Terser normally does that for
  us. Built-in/DOM property names can be exempt; see the per-instance module
  experiment before choosing a new property name.
- A helper added only to shorten a short repeated expression, such as one line
  of arithmetic or a small `map`. The call indirection can cost more than the
  repetition did.
- Abstractions or cached state added solely to remove repetition, without a
  build comparison behind them.
- Replacing `Infinity`, which Terser already shortens to `1/0`.
- Assuming recomputation is worse than reusing existing state, or the reverse.
  Either can win; measure.

## Experiment references

- [Bounciness consistency](references/bounciness-consistency.md): item and
  ordinary-module alignment, preserving the bouncy shield and drill grip.
- [Measured experiments](references/measured-experiments.md): indexed history
  covering compression, rendering, UI, entities, input and physics, including
  the 2026-09-07 camera/momentum and collision-damage experiments.
- [Fallback and canvas experiments](references/fallback-and-canvas.md):
  redundant updates, coordinate defaults, glow caching and canvas state.
- [Prism and array indexing experiments](references/prism-and-array-indexing.md):
  seam-safe beam rendering, corner predicates and production array access.

- [Ship, docked UI and prism experiments](references/ship-docked-and-prism.md):
  measured ship, docked UI, prism, asteroid and collision refactors.
- [Audio and collision experiments](references/audio-and-collision.md):
  the 2026-09-10 sound-system golfing pass, including the `direct-audio-buffer`
  regression that silently broke real Firefox playback despite passing every
  automated check - read this before reordering a `source.buffer` assignment
  relative to filling its samples.

Search these notes for the target file and proposed transformation, then read
its measurements and invariants. Add results to the relevant reference; keep
workflow here and avoid duplicating experiment entries.
