---
name: code-golfing
description: Shrink Unicorn Mining Co.'s built ZIP. Use when optimizing, minifying or code-golfing existing code, and read the measured experiments before trying an idea that has already been tried.
---

# Code golfing

Size is judged by the built ZIP and nothing else. Read the measured experiments
at the bottom before spending a build on an idea somebody has already priced.

## How to measure

- Roadroller compresses repeated code well, so fewer source characters do not
  guarantee a smaller entry. Only the ZIP settles it.
- Record a baseline with the same build command before editing, and compare
  after. All builds pass Roadroller the fixed seed `13312`, so sizes compare
  directly.
- Change one thing at a time and build between each, or the numbers mean
  nothing.
- `npm run build:slow` for anything structural, `npm run build:fast` for a
  single-line or localized change. Not `build:full` while iterating: far more
  Terser passes, too slow, and its absolute size is not the number to chase.
- Report only the before/after advzip sizes and the difference.
- Run `npm run lint` afterwards, reporting it only if it fails. Braces, spacing
  and line breaks are free, so a lint fix never costs bytes.

## What tends to work

- Deleting something outright. Removing a whole property, argument or return
  value beats restructuring an expression, every time.
- Truthy checks and omitted properties, rather than setting or comparing `null`
  or `undefined` where falsy values have no distinct meaning.
- A helper replacing a genuinely duplicated multi-line block. Roadroller dedupes
  exact repeats better than structurally-similar ones.
- Boolean state written as `true` or `false`, left for Terser to shorten. Keep
  numbers for levels and counters, and falsy sentinels for values that otherwise
  hold objects.
- Checking whether a guard is already redundant, in that the general case
  produces the same result without it.
- Reusing the idioms the codebase already uses elsewhere, which give Roadroller
  matching context. A bare `for` loop is novel text next to a `map` or
  `forEach`, and usually costs more than the callback argument it saves.

## What tends not to work

- Shortening names of variables, properties or functions. Terser does that for
  us, so descriptive names cost nothing.
- A helper added only to shorten a short repeated expression, such as one line
  of arithmetic or a small `map`. The call indirection can cost more than the
  repetition did.
- Abstractions or cached state added solely to remove repetition, without a
  build comparison behind them.
- Replacing `Infinity`, which Terser already shortens to `1/0`.
- Assuming recomputation is worse than reusing existing state, or the reverse.
  Either can win; measure.

## Measured docking UI experiments

`build:slow`, seed `13312`, against the August 2026 docking implementation.
Re-measure if the surrounding code changes substantially.

- Combining the dock menu's back and launch handling saved 5 bytes; literally moving its private stage into `main.js` was unnecessary.
- Reusing the action list within one render saved 13 bytes.
- Defining selectable craft slots by a truthy `fits` property saved 8 bytes.
- Removing the then-unreachable `mount.fits` guard saved 5 bytes.
- Initializing owned modules once beside the starter loadout saved 6 bytes.
- Omitting `filter(Boolean)` from that starter list saved 1 byte.
- Removing the shared `spend()` helper cost 17 bytes.
- Replacing repeated label objects with a rendering helper cost 17 bytes.
- Detecting priced actions by action-name length cost 3 bytes.
- Caching the action list for the whole right-column interaction cost 10 bytes.
- Removing BUY's repeated affordability branch while retaining `spend()` cost 27 bytes.
- An explicit unique starter-module list cost 33 bytes; deduplicating it with `Set` cost 5 bytes.

## Measured floodlight prism experiments

`build:slow`, seed `13312`, against the August 2026 rewrite of `src/prism.js`.

- Folding the spectrum clip's scratch `Path2D` into the accumulated `covered` path saved 15 bytes.
- Dropping the `range` property off the returned beam once nothing read it saved 18 bytes.
- Representing runs as plain arrays of rays, rather than `{ hit, rays, to }` objects, saved 5 bytes.
- Deriving the deflection from a ray's own start, rather than storing it per ray, saved 3 bytes.
- Building the spectrum by mapping colour names through `colors` cost 31 bytes.
- Replacing the `edges` fractions `map` with a `for` loop cost 30 bytes.
- Inlining the single-use `directionOf` cost 19 bytes.
- Aiming stripes with `movePoint` and `Math.atan2` instead of `rotatePoint` cost 18 bytes.
- Reusing `lens + reach` as a local cost 17 bytes.
- Building `litPath` out of the shared `strip` helper cost 13 bytes.
- A pre-reversed spectrum array, to drop a ternary, cost 11 bytes.
- An `averageOf` helper shared by two of the run's averages cost 10 bytes.
- Replacing `spectrum.forEach` with a `for` loop, to drop its unused `color` argument, cost 8 bytes.
- A `bands` const for `spectrum.length`, used three times, cost 2 bytes.
- Hoisting the constant `edges` array to module level cost 1 byte.
- Deleting the sheet-crossing clip entirely saved only 9 bytes, and the `mask` clip in `drawInside` only 2, so both were kept.
- Declaring `cross`'s `face` with its other callback locals, immediately before the guard, saved 3 bytes. Moving it directly after `edge` instead cost 17 bytes, and declaring `start` before `denom` cost 23 bytes.
- Moving the shared `strip` path builder from `prism.js` to the end of `drawing.js` saved 5 bytes. Placing it immediately after or before `shapePath` instead cost 6 and 12 bytes respectively.
- Inlining the single-use `acrossRun` helper saved 1 byte.
- Replacing `cross`'s temporary vectors with scalar edge and start coordinates cost 9 bytes despite reducing pre-Roadroller JS by 33 bytes.
- Moving the spectrum's thin-sheet guard below all of its local calculations cost 13 bytes.
- Making `fillOf` assign `ctx.fillStyle` rather than return its gradient cost 3 bytes; using the `spectrum.forEach` callback's `color` on one ternary branch cost 1 byte.
- Rewriting `outlineOf` with the shared `rotatePoint` helper cost 7 bytes despite reducing pre-Roadroller JS by 32 bytes.
- Moving `refract` to `vector.js` cost 14 bytes, and moving `cross` beside `within` in `polygon.js` cost 44 bytes.
- Moving `fillOf` beside its call or into `lighting.js`, and reordering the new `strip` import, were neutral.
- Removing the production-unused returned `outlines` property cost 21 bytes, and moving it after `rays` cost 20 bytes, so its presence and original property order were retained.
