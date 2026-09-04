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

## Measured build pipeline compressor experiments

- `compress: { pure_getters: true }` saved 32B after `advzip` (to 13832B).
  This assumes property reads have no side effects, so re-evaluate it if the
  game adds accessor properties.
- Disabling JSZip's `streamFiles` flag removed the one entry's 16B data
  descriptor before `advzip`, but recompression still produced a 13832B ZIP.
  Keep streaming enabled; it has no release-size cost.
- `unsafe_undefined`, `unsafe_methods`, `compress.ecma: 2015` (which enables
  the configured `unsafe_arrows` transform), and `keep_fargs: false` all left
  the fast ZIP unchanged at 14044B. Do not re-test them until production code
  adds relevant syntax.
- Terser 5.50 supports `compress.ecma: 2024`; it also left the fast ZIP at
  14044B. It does not alter Vite's browser output target, but adds no useful
  compressor transform for the current source.

## Measured background experiments

`build:slow`, seed `13312`, against the September 2026 background rewrite. The
retained background and shared-loop changes took advzip from 13524B to 13408B.

- Moving the named sky modes and their `parts.includes(...)` guards wholly
  behind `DEBUG` saved 51 bytes.
- Inlining the three uses of `wrapped` as one nine-step countdown loop saved 6
  bytes. Nested reverse loops cost 10 bytes instead.
- Consuming the cloud, dot and sparkle counts with `while (count--)` saved 9
  bytes. Using the same counter-only idiom in `vector.move` and
  `shrapnel.spray` saved another 5; forcing it onto main's substeps or the
  indexed wrapping loops cost 21 and 20 bytes.
- Replacing mixed layer objects with one dot-count list and index-derived cloud
  counts, sizes, sparkle counts and depths saved 26 bytes cumulatively. Three
  explicit `makeTile` calls still cost 4 bytes.
- Inlining the single-use `tilesOf` was neutral. Checking each stale canvas
  before replacing it with its bitmap saved 3 bytes; replacing the remaining
  background `forEach` calls with loops cost 17 bytes together.
- Putting only glow values into every layer cost 22 bytes, and completing that
  idea as a generic data-driven dot/sparkle renderer cost 48 bytes. The two
  concrete render blocks remained better.
- Direct modulo wrapping for `left`/`top` beat the prior `Math.floor` plus
  `Math.round` formulation by 17 bytes; adding only `Math.round` cost 21. Keep
  the logical span rounded, though: a fractional span caused a visible one-pixel
  seam, and oversizing the canvas fixed it but cost 1 byte.
- Hard-coding the fixed four-entry palette length saved 3 bytes. Replacing the
  random bracket indexes with `.at(...)` cost 23 bytes for the palettes and 25
  across all four sites; bitwise random-index truncation cost 8 bytes.
- Validate tiling changes while holding movement through exact positive and
  negative repeat boundaries. Ordinary screenshots can miss a join because a
  background tile is wider than the viewport.

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

## Measured positional-argument experiments

`build:slow`, seed `13312`, against the September 2026 docked UI. Test each
conversion in its current surrounding output: Roadroller's dictionary means a
result can change after another retained conversion.

- Named-property objects are already quite cheap because Terser mangles their
  keys. Inspect the generated `dist/minified.js` when measuring: a destructured
  one-property function can remain as an invoked wrapper, whereas a positional
  argument can allow its body to inline directly into the caller.
- Converting `renderText(props)` to `renderText(game, text, x, y, size, color,
  align)` saved 43 bytes. Use documented positional arguments; `align` is a
  bit field (1 centre, 2 bottom, 4 right) so the old independent alignment
  flags stay available without another object.
- Converting `renderBlasts({ ctx })` to `renderBlasts(ctx)` saved 11 bytes.
- `renderSparks({ ctx })` initially cost 16 bytes, but after the `renderText`
  conversion it saved 9 bytes: its destructured version remained an IIFE in
  the minified output, while the positional version inlined. Retain the
  positional form and remeasure context-sensitive trials after material wins.
- `litPath({ rays })` cost 13 bytes before, and 5 bytes after, the `renderText`
  conversion; the caller's added `.rays` costs more than the smaller parameter.
- `runsOf({ rays })` cost 11 bytes before, and 8 bytes after, the `renderText`
  conversion, for the same added-caller-property reason.
- `Craft.momentum({ x, y })` cost 2 bytes; `GameLoop({ render, update })` cost
  1 byte; and `pathFor({ path, points, unclosed })` cost 22 bytes. Keep all
  three object forms.

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
- Making `fillOf` assign `ctx.fillStyle` rather than return its gradient saved 3 bytes in the August build, but cost 18 bytes when remeasured after the September changes; keep the returned gradient in the current context. Using the `spectrum.forEach` callback's `color` on one ternary branch cost 1 byte.
- Rewriting `outlineOf` with the shared `rotatePoint` helper cost 7 bytes despite reducing pre-Roadroller JS by 32 bytes.
- Moving `refract` to `vector.js` cost 14 bytes, and moving `cross` beside `within` in `polygon.js` cost 44 bytes.
- Moving `fillOf` beside its call or into `lighting.js`, and reordering the new `strip` import, were neutral.
- Removing the production-unused returned `outlines` property cost 21 bytes, and moving it after `rays` cost 20 bytes, so its presence and original property order were retained.
- Approximating `180 / Math.PI` as `57.296` cost 5 bytes; `57.3` was neutral, so the exact conversion was retained.
- Retrying the spectrum loop after the surrounding changes cost 20 bytes for a forward `for`, 31 bytes for a countdown `for`, and 3 bytes for either `map` or `some`; `forEach` remained best.
- Letting `strip` accept either point arrays or a run of rays made `insidePath` simply call `strip(run)` and saved 15 bytes originally, and 10 bytes when restored in the September build. Drawing every run directly into one path instead cost 38 bytes.
- Giving `strip` a destination path and avoiding `addPath` cost 1 byte before that generalisation and 22 bytes after it. Moving the generalised helper back into `prism.js` also cost 22 bytes.
- In the September remeasure, moving `strip` back into `prism.js` cost 11 bytes and replacing its first-point `moveTo` branch with unconditional `lineTo` cost 15. Passing the default far edge explicitly was neutral; replacing the spectrum slices with explicit pairs cost 3 bytes, while mapping only exits or only entries cost 8 and 15 bytes. Keep the generalised helper at the end of `drawing.js`.
- Replacing the generated spectrum edges with three-decimal constants cost 11 bytes.
- Approximating both cone range and angle cost 13 bytes. The small-angle ratio alone was neutral, while using forward rather than diagonal reach cost 1 byte.
- Addressing reversed spectrum colours with `spectrum.at(~band)` cost 1 byte; combining it with the callback's `color` cost 3 bytes.
- Baking spectrum strength into `#RGBA` colours with an `e` alpha cost 30 bytes when mapping the spectrum, 6 bytes when suffixing the selected colour, and 3 bytes when suffixing once inside `fillOf`. Removing `globalAlpha` entirely still cost 6 bytes and also removed the lamp fade, so `lamp.anim * spectrumStrength` was retained.
- Stopping a sheet inverting, by holding its width to at least the width of the beam feeding it, was free. Growing the existing slanted `span` about its middle by the shortfall cost 38 bytes; dropping `span` and `first` for a `middle` point with the stripes laid squarely across `side` cost 3, and then reusing that same `middle` as the gradient's root, in place of `near[spectrum.length >> 1]`, saved 5. A one-sided `width` also removes `sense` and both `Math.abs(width)` calls.

## Measured Path2D, outline and alpha experiments

`build:slow`, seed `13312`, against the September 2026 outline and prism code.

- `Path2D.addPath` accepts a plain `DOMMatrix2DInit`. Replacing translation-only `new DOMMatrix().translate(...)` calls with `{ e, f }` saved 1 byte in `outline.js` and 3 bytes in `text.js`. Prefer this as the first experiment when only translation is needed.
- For prism rotation plus translation, an inline six-property matrix object cost 3 bytes, writing transformed points directly into the mask cost 1, and caching trigonometry plus mapping the points cost 14. Reusing the already transformed outline through `mask.addPath(shapePath(outline))` saved 8 bytes and removed `DOMMatrix` from the build. In general, try to avoid constructing `DOMMatrix`, but measure full affine replacements: spelling out all six fields can lose.
- Replacing the outline's eight normalized grid offsets with 16 evenly spaced trig offsets saved 21 bytes. `Array.from` with a callback-local angle beat a chained `forEach`, a countdown loop, array spread, and duplicating the angle expression.
- Halving those offsets with `/ 2` cost 9 bytes; multiplying by `0.5` cost 20 bytes. Neither was retained in the measured version.
- Fixed numeric alpha suffixes remained best as template literals in source. Changing all eight to numeric concatenation such as `color + 7` cost 14 bytes, and changing only the outline cost 1 byte, even though Terser emits fixed templates as string concatenation. Keep dynamic alpha concatenations and hexadecimal letter suffixes as they are unless a build proves otherwise.

## Measured cargo-scoop experiments

`build:slow`, seed `13312`, against the September 2026 cargo-scoop model. The
retained changes took advzip from 14295B to 14264B.

- Replacing the two doors, each of which hid itself on the opposite mount, with
  one door mirrored from `Math.sign(mount.y)` saved 29 bytes by removing a model
  part and the empty-points branch.
- The door delta always has length `scoopLength`, so replacing its `Math.hypot`
  normalization with direct sine and cosine offsets was neutral but removed
  unnecessary runtime work. Inlining that single-use point calculation into
  the model then saved 2 bytes.
- Replacing `Math.sign` with a ternary cost 19 bytes. Reusing the calculated
  hinge Y in the endpoint-Y expression cost 20 bytes. Keep the repeated
  `side * scoopLength` form unless the surrounding compression context changes.
- Verify this model by checking that the lower door's reversed point order is
  the Y-mirror of the upper door at closed, partly open, and fully open states.

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
- Removing amethyst asteroids' center-only burial branch after general burial became center-weighted saved 10 bytes.

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

## Measured player-state experiments

`build:slow`, seed `13312`, against the September 2026 player implementation.
The retained set took advzip from 14254B to 14209B.

- The BUY action already checks affordability while constructing its current
  action list. Removing `spend` and expressing the purchase as negative earnings
  saved 13 bytes; after moving pilot state onto the ship, removing `earn` too and
  mutating the existing `ship`/`craft` arguments directly saved another 6.
- Moving the singleton credits, note and timer from a separate `player` object
  onto `playerShip` saved 2 bytes and removed its imports. Removing the explicit
  starting `x`/`y` or empty note instead cost 11 and 12 bytes.
- Only the Mustang can carry cargo, so removing `roomFor`'s unreachable
  no-capacity fallback saved 4 bytes. Inlining `roomFor` cost 7 bytes, inlining
  the one-call `stow` cost 10, and combining the two helpers was neutral.
- Caching the recovered-credit value used three times in `scoop` saved 6 bytes.
  Caching a module price across BUY and SELL cost 5 bytes.
- Inlining the one-use `thrusting` calculation into `playerShip.fly` saved 4
  bytes. Unary coercion cost 1 byte there, and passing an initialized Up-key
  boolean directly was neutral, so keep the numeric ternary.
- `Road` is excluded from production, making its `drives` guard unreachable;
  removing that guard saved 3 bytes. Restore it if roads are re-enabled.
- Direct subtraction of held turn keys is unsafe while their map entries are
  absent: it produces `NaN` before both keys have fired. Initializing only `ht`
  and `ft` to `false` made subtraction safe and saved 10 bytes; initializing
  every bound key cost 5 bytes instead. Keep these literal keys reserved from
  property mangling because keyboard events write the same map dynamically.
- Inlining `say` cost 6 bytes, and allowing the note timer to run negative with
  a positive UI check cost 16 bytes. Keep the helper and zero clamp.
- Always calling `renderText` with `noteFor ? note : ''` saved 1 byte in
  repeated builds. Clearing the note from the timer update instead was 1 byte
  worse without the clamp and 16 bytes worse with it.
- During undocking, moving the forced `fly(1, 0)` into `flyOut` to ignore all
  movement input cost 6 bytes; retaining one `fly` call and gating its turn from
  a saved launch boolean cost 22. The existing `flyOut(...) || downKeys.Up`
  formulation stays smaller, even though it permits steering during launch.
- The brief full-bright flare at the end of launch comes from clamping
  `launching` to zero before testing `launching && launching <= 2`: that final
  active frame selects full power. Preserve this ordering. Inlining the
  `coasting` expression cost 11 bytes, while letting inactive `flyOut` fall
  through with `undefined` instead of returning explicit `false` saved 2.

## Measured keyboard experiments with 100 advzip iterations

`build:slow`, seed `13312`, against the September 2026 keyboard implementation.

- Normalizing browser key names to their final two characters saved 33 bytes; restoring the array-based binding API cost 11 bytes, and restoring unused `keyPressed` bookkeeping cost 11 bytes.
- Exporting `downKeys` for three direct player-control reads saved 2 bytes. Removing only `keyDown`'s `!!` coercion cost 28 bytes, while deleting unused unbinding exports was neutral.
- Replacing the two keyboard `addEventListener` calls with chained `window.onkeyup` and `window.onkeydown` assignments saved 6 bytes. Putting `onkeyup` first saved another 18 bytes despite identical source length and behavior.
- Explicit callback guarding cost 11 bytes versus optional invocation. Folding the held-state assignment into its callback condition cost 10 bytes.
- Registering handlers at module load cost 1 byte, looping over the two listener names cost 17 bytes, and storing held state on callback functions cost 33 bytes.
- Using the event type's truthy sixth character cost 1 byte; comparing its length was neutral. Arrays used as the held-key and callback maps cost 21 and 1 bytes respectively.

## Measured ship and station refactor experiments

`build:slow`, seed `13312`, against the September 2026 split of `craft.js` into
`ship.js` and `station.js`. The retained set took advzip from 13952B to 13823B.

- Deleting the cached station hull gradient (`hullGradient`, `relightCraft`,
  `craft.litAt`, `shadingStep`) and lighting stations with the same per-frame
  `litFill` as ships was the single biggest win. A station hull piece has no
  `module.health`, so `worn` already lands on `2`, which is exactly the shade
  the cached gradient used. FPS was unchanged at ~85 in the DEBUG counter.
- The single ship and station types were baked into `ship.js` and `station.js`,
  removing `craftData`, `shipTypes`, `stationTypes` and the two index files.
  Together with the lighting deletion and folding the docking bay into the
  station hull, this saved 80 bytes.
- Having the constructor call `fixHull()` rather than repeat the hull-building
  loop saved 23 bytes: building a hull from nothing is the same job as putting
  a broken one back together.
- Deleting the `accel` getter and the `this.mass`/`this.drag` guards that only
  a station needed, by guarding the whole flight block with `&& this.mass`,
  saved 11 bytes. Inlining the single-use `throttle` getter saved 1 byte.
- A shared `forget(list, entry)` for the five `list.splice(list.indexOf(x), 1)`
  sites saved 16 bytes across `sprite`, `item`, `ship`, `asteroid` and the
  docked UI.
- Replacing the empty `cockpit` module and its mount with a `core: true` flag
  on the hull piece the pilot sits in was byte-neutral, and was kept as a
  simplification. `this.cockpit` is now that hull segment itself.
- Helper extraction lost every time here, even for genuinely duplicated blocks:
  a shared `debris()` builder for `detach` and `fracture` cost 7 bytes, an
  `edgesOf(segments)` wrapper for the four `outerEdges(x.map(...))` calls cost
  21, and a `shove(craft, away)` wrapper for the three `applyForce` calls cost
  33. Roadroller dedupes the literal repeats better than it does a call.
- The same applies to point data: deriving the two docking-bay halves from
  slices of the shared bay ring cost 11 bytes over writing all twenty points
  out. Prefer repeated literal geometry.
- Dropping `holds`'s `child.dockedTo === this` term, which is redundant because
  a docked ship sits at the station's own position, cost 7 bytes. Introducing a
  `position` local in `fracture` cost 6.
- Reading the drawing context from `game` instead of storing `ctx` on every
  `Sprite` cost 6 bytes.
- Removing the `Station` class and calling `new Ship(props, corral)` at the one
  call site saved only 5 bytes, so the class was kept.
- Duplication does **not** beat inheritance here. Making `Station` a standalone
  `Sprite` subclass with its own trimmed `makeSegment`, `hitboxes`, `holds`,
  `momentum` and `add`/`remove`, so nothing was shared with `Ship`, cost 117
  bytes. Roadroller dedupes *identical* text well, but a trimmed copy is only
  similar, and it pays for every difference; sharing a method costs nothing at
  all. Reach for duplication only when the two copies would be character for
  character the same.
- Moving `holds` off `Ship` and onto `Station` alone, with `local-movement.js`
  calling `mover.holds?.(child)`, saved 7 bytes: only a station ever carries
  anything, and a docked ship sits at the station's own position so the
  distance test already covers it.

## Measured entity placement experiments

`build:slow`, seed `13312`, continuing the ship and station refactor above.
The retained set took advzip from 13816B to 13814B.

- Moving the debris `lifetime` countdown out of both `Ship.update` and
  `Asteroid.update` and into `Sprite.update` saved 5 bytes. Ship's flight block
  keeps its own `!this.lifetime` guard, because debris has no `forward`.
- Making `renderCraft` a `Ship.render(scenery, zIndex)` method and deleting
  `craft-render.js` (moving `active` and `healthOf` into `ship.js` beside
  `damage`) cost 10 bytes on its own, but two follow-on wins brought it back to
  +3 net, which was accepted for the consistency: all four entity types now
  render themselves.
- Reordering `Asteroid.render`'s prologue to `lineJoin` before `lineWidth`, so
  it matches `Ship.render` and `Item.render` character for character, saved 3
  bytes. This is the one place aligning near-identical code across entities
  actually paid.
- Dropping the dead `scenery || []` fallbacks in the beam tracing, now that
  `main.js` always passes the sprite list, saved 4 bytes.
- Alphabetising `Asteroid.hitboxes`'s keys to line them up with `Ship.hitboxes`
  cost 3 bytes, so the original order was kept. Matching *key order* between
  two objects that hold different keys does not help.

## Measured debris decay experiments

`build:slow`, seed `13312`. Replacing the `lifetime` countdown with health
decay took advzip from 13814B to 13813B, so the reuse of `health` was free.

- `cockpit` already tells debris and stations apart from a crewed ship, so the
  three `!this.lifetime` guards in `Ship` (`maxSpeed`, the flight block and the
  fracture block) became `this.cockpit` checks, which also made the flight
  block's `&& this.mass` station guard redundant. Saved 5 bytes.
- Debris now carries `decay`, the health it loses a second, and `Sprite.update`
  removes it once `health` runs out. As a straight swap this cost 8 bytes,
  because ship debris needs two properties where `lifetime` was one.
- Setting `decay`, `drag`, `health` and `mass` once in the `Ship` constructor's
  debris branch, rather than in both the `detach` and `fracture` object
  literals, saved only 1 byte — Roadroller was already handling those two
  near-identical literals well.
- Shrinking debris health from `50 + Math.random() * 10` at rate 6 to
  `9 + Math.random()` at rate 1 saved 3 bytes for the same 9-10 second life.
- Making `decay` a bare flag with one uniform rate, so `Sprite` could do
  `this.health -= dt`, cost 18 bytes: it forces asteroid chunks to be given a
  debris health of their own, and that duplicated expression costs more than
  the `* this.decay` it removes. Keep `decay` as a per-object rate, and let a
  rock chunk wear away at its own mined health (rate 6, so a bigger lump lasts
  a little longer).

## Measured segment outline and path experiments

`build:slow`, seed `13312`, against the `src/ship.js` segment pathing and shape
construction. The retained changes took advzip from 13832B to 13809B (and
`build:full` from 13831B to 13807B).

- Deleting the `pathFor` helper entirely and inlining conditional spread
  `...(points && { path: (segment) => shapePath(points.call ? points(segment) : points, unclosed) })`
  into `makeSegment` saved 23 bytes (advzip). Segments without `points` (e.g.
  the shield bubble) inherit `part.path` directly via prototype from
  `Object.create(part)`.
- Reusing the `.call ? ... : ...` idiom matches `Ship.render`'s `lines.call`
  and `hitboxes()`, letting Roadroller deduplicate the expression across the
  module without introducing unique unmangled method names.
- Checking `shape = points?.[0] && shapeOf(points, mount)` saved 2 bytes over
  `Array.isArray(points)` in full builds, and completely eliminated
  `Array.isArray` from the minified bundle.
- Re-adding `Array.isArray(points)` into `makeSegment` (`Array.isArray(points) ? points : points(segment)`)
  regressed by 23 bytes (to 13832B advzip): while `Array.from` is used elsewhere,
  `isArray` is an unshared identifier and disrupts Roadroller's reuse of the
  `foo.call ? foo(...) : foo` pattern.

## Measured shrapnel and particle experiments

`build:slow`, seed `13312`, against `src/shrapnel.js` and `src/particles.js`.
The retained changes took advzip from 13809B to 13745B (and `build:full` from
13807B to 13743B).

- Simplifying `spray` to take `(x, y, color, carry)` without the unused `amount`
  loop/math and reading `carry.velocity` directly in `movePoint(carry.velocity, angle, pace)`
  saved 19 bytes and allowed removing the `Vector` import from `shrapnel.js`.
- Dropping alpha/transparency from sparks removed `ctx.globalAlpha` entirely,
  and simplified spark life to a single `health: 0.25 + Math.random() * 0.25`
  countdown (`spark.health -= dt`), dropping the `decay` property from sparks
  for an additional 4B save.
- Removing `|| 1` from `Math.hypot(spark.dx, spark.dy)` in `renderSparks` saved
  3-4 bytes, as sparks always have non-zero velocity and never divide by zero.
- Removing `drag` (linear speed without per-frame exponential slowdown) eliminated
  the `slow` calculation and inlined clean `(spark.health -= dt) > 0`
  movement.
- Removing `ctx.lineCap = 'round'` in `renderSparks` removed the only `lineCap`
  property access across the entire codebase.
- Rounding spark speed to `100` matched the round constant patterns.
- Inlining pace as `40 + Math.random() * 60` cost 26 bytes compared to
  `100 * (1 - Math.random() * spread)` due to Roadroller's context matching.
- Stubbing/commenting unused road particle generators in `particles.js` removed
  dead color-palette queries.
- Removing `ctx.lineCap = 'round'` in `renderSparks` removed the only `lineCap`
  property access across the entire codebase.
- Rounding spark speed to `100` matched the round constant patterns.
- Inlining pace as `40 + Math.random() * 60` cost 26 bytes compared to
  `100 * (1 - Math.random() * spread)` due to Roadroller's context matching.
- Stubbing/commenting unused road particle generators in `particles.js` removed
  dead color-palette queries.
