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
  single-line or localized change. Slow uses 100 advzip iterations, enough to
  track the 1,000-iteration full build more realistically without its runtime.
  Do not use `build:full` while iterating: it has far more Terser passes, is too
  slow, and its absolute size is not the number to chase.
- Report only the before/after advzip sizes and the difference.
- Run `npm run lint` afterwards, reporting it only if it fails. Braces, spacing
  and line breaks are free, so a lint fix never costs bytes.

## Areas to avoid

- Do not try to code-golf scripts/world-preview.js, src/benchmark.js, or any code
  which is locked behind the DEBUG or BENCHMARK flags as that code is not
  included in the ZIP, and is only for development and testing.
- The textjs glyphs have already been heavily optimized and are not worth further
  golfing attempts unless it is specifically requested for.
- Try to avoid moving code into main.js unless it makes a significant difference,
  as we are trying to keep that file in particular as readable as possible.

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
- Extracting the player key bindings cost 14 bytes as a local helper and 24–60 bytes across dependency-safe modules, callback parameters, split binders, or a `player.js`/docked-UI cycle, so the bindings stayed inline in `main.js`.

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
- Approximating `180 / Math.PI` as `57.296` cost 5 bytes; `57.3` was neutral, so the exact conversion was retained.
- Retrying the spectrum loop after the surrounding changes cost 20 bytes for a forward `for`, 31 bytes for a countdown `for`, and 3 bytes for either `map` or `some`; `forEach` remained best.
- Letting `strip` accept either point arrays or a run of rays made `insidePath` simply call `strip(run)` and saved 15 bytes. Drawing every run directly into one path instead cost 38 bytes.
- Giving `strip` a destination path and avoiding `addPath` cost 1 byte before that generalisation and 22 bytes after it. Moving the generalised helper back into `prism.js` also cost 22 bytes.
- Replacing the generated spectrum edges with three-decimal constants cost 11 bytes.
- Approximating both cone range and angle cost 13 bytes. The small-angle ratio alone was neutral, while using forward rather than diagonal reach cost 1 byte.
- Addressing reversed spectrum colours with `spectrum.at(~band)` cost 1 byte; combining it with the callback's `color` cost 3 bytes.
- Baking spectrum strength into `#RGBA` colours with an `e` alpha cost 30 bytes when mapping the spectrum, 6 bytes when suffixing the selected colour, and 3 bytes when suffixing once inside `fillOf`. Removing `globalAlpha` entirely still cost 6 bytes and also removed the lamp fade, so `lamp.anim * spectrumStrength` was retained.

## Measured world generation experiments

`build:slow`, seed `13312`, against the August 2026 world generation, taking
13941B down to 13572B.

- Replacing mulberry32 in `seeded-random.js` with a one-line LCG saved 25 bytes.
- Dropping `distribute`'s `avoid` argument, `variance` spacing, `collisionRadius` fallbacks and its impossible negative-radius guard saved 35 bytes together.
- Replacing the weighted `asteroidFieldProfiles` table, `weightedKey` and `randomStep` with a cubed roll over the price-ordered item list saved 129 bytes.
- Burying an item in a random empty leaf, rather than distributing it and snapping to the nearest, saved 38 bytes and removed `distribute` from `asteroid.js` entirely.
- Removing the now-unreachable `Math.max(3, ...)` from `pointsFor` saved 18 bytes.
- Storing contents as `itemTypes` indexes, dropping `main.js`'s name-to-item map, saved 42 bytes.
- Dropping the rotated field ellipse saved 44 bytes, and its now-unused `rotation` property another 5.
- Returning the items rather than the `placed` list, taking the last attempt whether it fits or not, saved 3 bytes and removed the caller's `slice`, but left hundreds of overlapping asteroids per world, so it was reverted.
- The world generator makes millions of `random()` calls, so a short-period generator (such as `(seed + 1) * 7 % 10009`) repeats positions outright. A Lehmer generator, `(seed + 1) * 48271 % 2147483647`, has a two-billion period without `Math.imul` or `>>>`, and saved 12 bytes over the 32-bit LCG.
- Removing `distribute`'s biggest-first `sort` saved 5 bytes, and its unused `density = 0` default 1 byte.
- Approximating the asteroid count as `fieldRadius ** 2 * aspectRatio / 1e5` saved 4 bytes.
- Making fields circular, dropping `aspectRatio` from both `distribute` and the field data, saved 20 bytes.
- A `scatter` helper for the near-identical station and wreck `distribute` calls cost 5 bytes.
- Dropping the `Math.sqrt` that spreads points evenly across the disc cost 19 bytes.

## Measured main and entity experiments

`build:slow`, seed `13312`, against the late-August 2026 `main.js`, `Craft`,
`Item`, `Asteroid`, and `Sprite` implementation. The retained set took advzip
from 13514B to 13506B. Deltas below were measured one change at a time against
the then-current retained baseline.

- Keeping the active-tier sprite count in a local rather than adding `count` to `game` saved 7 bytes.
- Removing `Sprite`'s unused no-argument constructor default saved 1 byte.
- Removing `Sprite.update`'s redundant `spin || 0` fallback was neutral and was kept as a simplification.
- Removing `makeSegment`'s unreachable zero-duration rate branch and `instantRate` saved 2 bytes.
- Destructuring all of `Item`'s locally used `glint`, `lines`, `notes`, `points`, `radius`, and `shades` together cost 2 bytes and was kept for consistency. Destructuring only `shades` cost 17 bytes.
- Centralizing the extra `game.crafts` and `game.items` registration in `Sprite` through static subclass collections cost 30 bytes.
- Replacing the two explicit craft thrust reducers with a property-driven helper cost 63 bytes.
- Removing the early `dead` guards from the nearby filter and distant update cost 30 and 46 bytes respectively; removing it from active-tier construction cost 14 bytes.
- Removing `Sprite.update`'s redundant `buried` guard cost 44 bytes.
- Removing `Asteroid`'s defensive empty `contents` default cost 28 bytes. Separating generated resource indexes from runtime contents with rest destructuring in `main.js` cost 51 bytes.
- Caching the module model length used by both thrust properties cost 3 bytes, and caching the nearby substep `dt` cost 13 bytes.
- Removing `Craft.unfit`'s currently redundant empty-mount guard cost 13 bytes, while flattening `Craft.update`'s lifetime branch cost 16 bytes.
- Caching `props.triangles` in the asteroid constructor cost 20 bytes, and changing its mass fallback to `||=` cost 13 bytes.
- Replacing the scenery `filter().forEach()` with one guarded `forEach()` cost 5 bytes. Caching all render types cost 19 bytes; caching scenery alone cost 6 bytes.
- Removing the currently unreachable dead-asteroid cargo-release branch cost 11 bytes, so it remained as defensive behavior.
- Replacing the four-update modulo with a bitmask cost 18 bytes.
- Making module keys uppercase and lowercasing them only while binding saved 1 byte. Packing both forms lowercase-first (`'dD'`), using index 0 for input and index 1 for the HUD, saved 15 bytes instead; uppercase-first was 3 bytes worse.
- With `'dD'`, `key[0]`, and `key[1]` held constant under `build:full`, direct indexing was 13319B advzip, adding `toLowerCase` to the input was 13351B, adding both `toUpperCase` calls to the HUD was 13343B, and using all three conversions was 13366B.
- Before slow builds used 100 advzip iterations, normalizing keyboard event keys to their final two characters saved 6 bytes. Searching registered fragments with `find`/`includes` cost 15 bytes, while expanding fragments with `includes` cost 59 bytes.
- Under that earlier build, removing the unused `keyPressed` state saved 2 bytes, accepting one key per `bindKeys` call saved 3, optional callback invocation saved 4, and sharing one handler between keydown and keyup saved 1. Registering listeners at module load cost 5 bytes, and storing held state on callback functions cost 8 bytes.

## Measured keyboard experiments with 100 advzip iterations

`build:slow`, seed `13312`, against the September 2026 keyboard implementation.

- Normalizing browser key names to their final two characters saved 33 bytes; restoring the array-based binding API cost 11 bytes, and restoring unused `keyPressed` bookkeeping cost 11 bytes.
- Exporting `downKeys` for three direct player-control reads saved 2 bytes. Removing only `keyDown`'s `!!` coercion cost 28 bytes, while deleting unused unbinding exports was neutral.
- Replacing the two keyboard `addEventListener` calls with chained `window.onkeyup` and `window.onkeydown` assignments saved 6 bytes. Putting `onkeyup` first saved another 18 bytes despite identical source length and behavior.
- Explicit callback guarding cost 11 bytes versus optional invocation. Folding the held-state assignment into its callback condition cost 10 bytes.
- Registering handlers at module load cost 1 byte, looping over the two listener names cost 17 bytes, and storing held state on callback functions cost 33 bytes.
- Using the event type's truthy sixth character cost 1 byte; comparing its length was neutral. Arrays used as the held-key and callback maps cost 21 and 1 bytes respectively.
