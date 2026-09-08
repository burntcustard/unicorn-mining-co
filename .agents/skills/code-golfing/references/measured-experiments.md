# Measured code-golfing experiments

Read relevant entries before retrying a candidate. Each result uses its own
source baseline. Retained means retained at the time; later changes may
supersede it. Validation claims describe the original run.

## Build settings

Current comparisons use `build:fast`, seed `13312`, and 10 advzip iterations.
The scripts changed on 2026-09-04: historical `build:slow`* used 100 advzip
iterations; old `build:fast` used one Terser pass without advzip. Historical
`build:full`* also differs from current fast builds. Compare results within
an experiment using the same settings; unrelated totals are not cumulative.

## Contents

- [Measured build pipeline compressor experiments](#measured-build-pipeline-compressor-experiments)
- [Measured sparkle experiments](#measured-sparkle-experiments)
- [Measured thruster glow experiments](#measured-thruster-glow-experiments)
- [Measured background experiments](#measured-background-experiments)
- [Measured docking UI experiments](#measured-docking-ui-experiments)
- [Measured positional-argument experiments](#measured-positional-argument-experiments)
- [Measured floodlight prism experiments](#measured-floodlight-prism-experiments)
- [Measured Path2D, outline and alpha experiments](#measured-path2d-outline-and-alpha-experiments)
- [Measured cargo-scoop experiments](#measured-cargo-scoop-experiments)
- [Measured world generation experiments](#measured-world-generation-experiments)
- [Measured main and entity experiments](#measured-main-and-entity-experiments)
- [Measured player-state experiments](#measured-player-state-experiments)
- [Measured keyboard experiments with 100 advzip iterations](#measured-keyboard-experiments-with-100-advzip-iterations)
- [Measured ship and station refactor experiments](#measured-ship-and-station-refactor-experiments)
- [Measured entity placement experiments](#measured-entity-placement-experiments)
- [Measured debris decay experiments](#measured-debris-decay-experiments)
- [Measured segment outline and path experiments](#measured-segment-outline-and-path-experiments)
- [Measured shrapnel and particle experiments](#measured-shrapnel-and-particle-experiments)
- [Measured collision metadata experiment](#measured-collision-metadata-experiment)
- [Measured camera, momentum, mining and sizing experiments (2026-09-07)](#measured-camera-momentum-mining-and-sizing-experiments-2026-09-07)
- [Measured collision damage threshold experiments (2026-09-07)](#measured-collision-damage-threshold-experiments-2026-09-07)
- [Measured fallback and canvas experiments](#measured-fallback-and-canvas-experiments)

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

## Measured sparkle experiments

`build:fast`, September 2026 rewrite of `background.js`'s sparkles.

- Merging the `+` and `x` into one `Path2D` via `path.addPath(cross, { a, b, c,
  d })` (nonzero winding, so the crossing is painted once instead of adding
  under `'lighter'`) cost 15B advzip versus filling the `x` separately with its
  own gradient — the DOMMatrixInit literal outweighs the gradient it removes.
  Kept for the look; the additive overlap was the whole problem.
- Hoisting the four `Math.SQRT1_2` reads in that literal into a `const` cost a
  further 5B (13559B -> 13564B) and was reverted. Repeated `Math.X` property
  chains compress well; a new binding name does not.

## Measured thruster glow experiments

`build:fast`, seed `13312`, against the September 2026 per-nozzle thruster glow.
The retained version is a shared `drawThrusterGlow(ctx, nozzle)` in `lighting.js`,
called after translating to each nozzle segment, with old `drawHalo` constants but
no cached gradient/path.

- Duplicating the halo-style helper in both `ship.js` and the unused
  `craft-render.js` cost bytes and obscured the real bundle path; keep the helper
  shared if the stale renderer stays in source.
- Moving the shared helper back to `lighting.js` saved 4B over duplicated helpers
  (13472B -> 13468B).
- Dropping the per-colour radial-gradient cache and creating the tiny gradient in
  the helper saved 27B (13468B -> 13441B).
- Dropping `circlePath(1)` and drawing the unit circle directly with
  `ctx.beginPath(); ctx.arc(...); ctx.fill()` saved another 13B (13441B ->
  13428B). Replacing `Math.PI * 2` with `7` looked shorter but cost 6B.
- In the cached `drawGlow` branch, replacing `const { scale } = game` with
  direct `game.scale` reads saved 5B after fixing the accidental duplicate
  `ctx.save()` in the measured source (13431B -> 13426B). Assigning
  `const scale = cache.scale = game.scale` inside the refresh block cost 8B,
  and swapping the comparison to `game.scale !== cache.scale` cost 2B.
- Losing attempts: inlining `haloReach`/`haloStrength` was neutral; moving
  gradient creation after the scale cost 5B; hoisting `nozzle.shades[2]` to a
  local and using `color + 6` cost 3B; folding reach into `strength` and deriving
  alpha as `/ 100` cost 19B; fully inlining the radial glow in `Ship.render()`
  cost 23B. Reusing `drawGlow` instead of the radial helper saved 14B more
  (13428B -> 13414B) but did not preserve the old `drawHalo` look as closely.
  Splitting `drawGlow` into `drawDockingBayGlow` plus an item-only glow cost
  19B while explosive items still used the generic glow path. After disabling
  explosive items, removing their fuse/glow/blast wiring saved 310B (13426B ->
  13116B), then renaming `drawGlow` to `drawDockingBayGlow` and dropping its
  no-cache/variable-strength branch saved another 14B (13116B -> 13102B).
  Deleting the now-unreferenced `explosion.js`/`items/explosive.js` files,
  disabled explosive comments, and no-op `Item.arm()` calls saved 1B more
  (13102B -> 13101B).
- Removing `thrusterSingleMd`, renaming `thrusterSingleXl` to `thrusterSingle`,
  and reducing its forward thrust to 22 saved 21B (13486B -> 13465B) under
  `build:fast`; retain the renamed module and its four-thruster progression.

## Measured background experiments

`build:slow`*, seed `13312`, against the September 2026 background rewrite. The
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

`build:slow`*, seed `13312`, against the August 2026 docking implementation.
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
- Restricting `moveSubSelection` to `stage > 1`, so left/right cannot move the
  vertical mount or module columns, cost 3 bytes (13370B -> 13373B,
  `build:fast`, 2026-09-08). Docked regression checks for both vertical stages
  passed, but the candidate was reverted because it did not save space.
- In a `build:full`* docked-UI remeasure, inlining its two-use bottom position,
  disabled-text colour, panel width, and `ship.slots` alias saved 16B together.
  Inlining the one-use `maxHealth` reduction instead cost 28B: keep expensive
  calculations cached even when their result has one consumer.
- Replacing the one-use `layoutButtons` helper with a preallocated action-button
  array populated by `forEach` saved 4B under `build:full`*. An inline `map`
  layout cost 14B; a `reduce` form saved 3B.
- Paint swatches (2026-09-04, `build:full`*): a shared `renderSwatch(ctx, x, y,
  size, color, wash)` exported from `ui/controls.js` and called from both the
  module-panel boxes and the docked paint swatches cost 20B more (13462B) than
  writing the same `fillStyle`/`fillRect`/`strokeStyle`/`strokeRect` sequence
  inline at both sites (13442B). Roadroller compresses the literally-repeated
  statement block better than a call site pair plus a cross-module export, so
  prefer duplicated identical drawing code over a tiny shared canvas helper.
- Paint swatch navigation and rendering (2026-09-04, `build:fast`, 13506B
  baseline). Wins: folding the separate `moveSubSelection` body into
  `moveSelection` behind a third `sub` argument saved 5B; dropping the
  remembered `actionFocus` (up off the paint row lands on the first action
  instead of the last one used) saved 22B; reading the worn paint off
  `mount.segments[0].shades`/`ship.shades` instead of recomputing it from
  `module.paints[mountIndex] || module.shades || ship.shades` saved 3B.
  Losses, all reverted: unifying the hull and module repaint into one
  `forEach` over a chosen segment list cost 3B; merging the two focus clamps
  into shared `lo`/`hi` locals cost 2B; landing on the first swatch instead of
  the worn one cost 5B *despite* less source; `ctx.strokeStyle = ctx.fillStyle
  = shades[2]` with a one-line conditional `fillRect` cost 11B; hoisting the
  repeated `y - rowPad + swatchInset` into a local cost 5B; precomputing the
  square as a `square` array spread into `fillRect(...square)` cost 12B; and
  deleting the `moveSubSelection` wrapper so `main.js` calls
  `moveSelection(±1, playerShip, 1)` cost 8B. The theme: repeated *identical*
  expression text is nearly free, and any local or spread that breaks the
  repetition costs more than it saves. Folding the swatch buttons into the
  existing `actionButtons` array (one layout, one render loop, `focused === i`
  throughout) cost 3B and was kept for clarity. Net 13506B ->
  13479B.
- Paint storage and swatch fill (2026-09-04, `build:fast`, 13479B baseline).
  Replacing the conditional `fillRect` with an always-drawn fill whose opacity
  digit is appended when unselected — `${shades[2]}${shades === selected ? '' :
  '3'}`, matching `renderButton`'s own idiom — cost 1B in `docked.js` but 21B
  more when the identical rewrite was applied to `ui/controls.js` too, so
  controls kept its conditional `fillRect`. Dropping per-mount
  `module.paints[mountIndex]` for a plain `module.shades` (which also deletes
  the `paints?.[craft.mounts.indexOf(mount)]` lookup from `ship.js`'s
  `makeSegment`) saved 16B, but only once the repaint reused shapes already in
  the file: `(hullMenu ? ship.segments.filter(({ hull }) => hull) :
  mount.segments).forEach(...)` beat a single combined
  `filter((segment) => hullMenu ? segment.hull : segment.module ===
  currentModule)` by 21B. Net 13479B -> 13464B.
- Per-instance modules (2026-09-04, `build:fast`): making `cargoBay` and
  `mount.module` hold `Object.create(type)` instances rather than the shared
  type, so paint follows a physical module, cost 61B in total (13464B ->
  13525B) — much less than the ~100B guessed up front. Naming the type link
  `type` cost 22B more than `oneOf`, because `type` is in Terser's `domprops`
  list and `mangle.properties` therefore refuses to rename it. **Check
  `domprops` before choosing a new property name**: anything the DOM also uses
  (`type`, `kind`, `pattern`, `name`, `key`, `value`...) stays full-length in
  the output. Colouring the docked menu's owned rows in their own paint, to
  tell two scoops apart, cost 6B of that total.
- Owned-module row swatch (2026-09-04, `build:fast`, 13525B baseline). Swapping
  the paint-tinted row text for a filled square on the right of the row cost
  59B as first written; hoisting the fixed `swatchX` column out of the loop and
  dropping the `'6'` dimming suffix on disabled rows brought it to 13549B
  (+24B). Two further attempts both lost: inlining `shadesOf(ship, item)[2]` as
  `(item.shades || ship.shades)[2]` cost 4B, and replacing the `const y =
  menuY(i)` local with two inline `menuY(i)` calls cost 20B. That last one
  contradicts the "repeated identical text is nearly free" pattern from the
  swatch-render experiments above, so treat that rule as a hypothesis to test
  rather than something to apply blind.
## Measured positional-argument experiments

`build:slow`*, seed `13312`, against the September 2026 docked UI. Test each
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

For the later seam-safe implementation and production-wide array-access sweep,
read [September prism and array indexing experiments](prism-and-array-indexing.md)
before retrying corner predicates, intersection-object reuse, property renaming,
or `.at()` versus bracket indexing. These use today's `build:fast` measurement.

`build:slow`*, seed `13312`, against the August 2026 rewrite of `src/prism.js`.

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

`build:slow`*, seed `13312`, against the September 2026 outline and prism code.

- `Path2D.addPath` accepts a plain `DOMMatrix2DInit`. Replacing translation-only `new DOMMatrix().translate(...)` calls with `{ e, f }` saved 1 byte in `outline.js` and 3 bytes in `text.js`. Prefer this as the first experiment when only translation is needed.
- For prism rotation plus translation, an inline six-property matrix object cost 3 bytes, writing transformed points directly into the mask cost 1, and caching trigonometry plus mapping the points cost 14. Reusing the already transformed outline through `mask.addPath(shapePath(outline))` saved 8 bytes and removed `DOMMatrix` from the build. In general, try to avoid constructing `DOMMatrix`, but measure full affine replacements: spelling out all six fields can lose.
- Replacing the outline's eight normalized grid offsets with 16 evenly spaced trig offsets saved 21 bytes. `Array.from` with a callback-local angle beat a chained `forEach`, a countdown loop, array spread, and duplicating the angle expression.
- Halving those offsets with `/ 2` cost 9 bytes; multiplying by `0.5` cost 20 bytes. Neither was retained in the measured version.
- Fixed numeric alpha suffixes remained best as template literals in source. Changing all eight to numeric concatenation such as `color + 7` cost 14 bytes, and changing only the outline cost 1 byte, even though Terser emits fixed templates as string concatenation. Keep dynamic alpha concatenations and hexadecimal letter suffixes as they are unless a build proves otherwise.
- `outline()` gained an optional `radius` multiplier param (default `1`) so `ui/controls.js` can shrink its halo to match `renderText`'s effective `textSize` scale, applied to both the module box and its key-underline. `build:fast`, seed `13312`, baseline (this feature, unmerged) 13464B: merging the box `rect()` and underline `moveTo`/`lineTo` into one shared `Path2D` (one `outline()`/`stroke()` call per row instead of two) cost 7 bytes (13471B); hoisting the repeated `outline(ctx, path, textSize); ctx.stroke(path);` pair into a local helper function cost 8 bytes (13472B). Roadroller apparently compresses the two separate near-identical blocks better than a merged or indirected one — neither was retained.
- `ui/docked.js`'s two paint-swatch blocks (the owned-instance indicator beside a menu row, and the paint-picker button) were consolidated into one `renderSwatch(x, y, shades, worn)` local closure inside `renderDocked`, replacing duplicated `new Path2D()`/`rect()`/`fill()`/`outline()`/`stroke()` sequences. `build:fast`, seed `13312`, against the two-block baseline (13500B, after adding the swatch outline and the stage-0 HULL/mount swatches): passing a fully-formed `fill` string as a 4th argument (`fill = shades[2]` default) measured 13501B (+1B, effectively a wash); moving the worn/wash decision inside the helper instead (`worn = 1` default, `fillStyle = \`${shades[2]}${worn ? '' : '3'}\`` built inside `renderSwatch`, call sites pass a boolean `shades === selected` instead of a template literal) measured 13499B (-1B), and was retained. Net effect of consolidating unlike-caller duplication here was close to neutral either way — worth trying, but don't expect a big win from merging two *different* (not identical) repeated blocks the way this one was.

## Measured cargo-scoop experiments

`build:slow`*, seed `13312`, against the September 2026 cargo-scoop model. The
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

`build:slow`*, seed `13312`, against the August 2026 world generation, taking
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
- World-generation sweep (2026-09-07, `build:fast`): mapping rich-field rolls
  with `randomResource(random) % 3 || 4` instead of separate diamond/opal
  reassignment saved 7B (13465B -> 13458B). Retained. Folding wreck colour
  assignment into the field map cost 1B, direct clue-record marking instead of
  `Set` membership cost 13B, and treating amethyst as `resource < 2` in clue
  labels cost 14B; all were reverted.

## Measured main and entity experiments

`build:slow`*, seed `13312`, against the late-August 2026 `main.js`, `Craft`,
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
- With `'dD'`, `key[0]`, and `key[1]` held constant under `build:full`*, direct indexing was 13319B advzip, adding `toLowerCase` to the input was 13351B, adding both `toUpperCase` calls to the HUD was 13343B, and using all three conversions was 13366B.
- Module-name activation keys (2026-09-08, `build:fast`): removing the four
  packed `key` properties, binding the lowercase first character of each module
  name, underlining the first HUD character directly, and excluding thrusters
  via their existing `forwardThrust` property saved 23 bytes (13360B -> 13337B).
  Retained.
- Global `forEach` to `map` preprocessing (2026-09-08, `build:full`): adding a
  `.replaceAll('.forEach(', '.map(')` custom replacement changed all 85 source
  occurrences and reduced the minified JS, but the advzip result was neutral
  (13331B -> 13331B). The transformed bundle rendered successfully in Firefox;
  lint and the collision, docked, and prism suites passed. Reverted because it
  added build-time indirection without shrinking the judged ZIP.
- Before slow builds used 100 advzip iterations, normalizing keyboard event keys to their final two characters saved 6 bytes. Searching registered fragments with `find`/`includes` cost 15 bytes, while expanding fragments with `includes` cost 59 bytes.
- Under that earlier build, removing the unused `keyPressed` state saved 2 bytes, accepting one key per `bindKeys` call saved 3, optional callback invocation saved 4, and sharing one handler between keydown and keyup saved 1. Registering listeners at module load cost 5 bytes, and storing held state on callback functions cost 8 bytes.

## Measured player-state experiments

`build:slow`*, seed `13312`, against the September 2026 player implementation.
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

`build:slow`*, seed `13312`, against the September 2026 keyboard implementation.

- Normalizing browser key names to their final two characters saved 33 bytes; restoring the array-based binding API cost 11 bytes, and restoring unused `keyPressed` bookkeeping cost 11 bytes.
- Exporting `downKeys` for three direct player-control reads saved 2 bytes. Removing only `keyDown`'s `!!` coercion cost 28 bytes, while deleting unused unbinding exports was neutral.
- Replacing the two keyboard `addEventListener` calls with chained `window.onkeyup` and `window.onkeydown` assignments saved 6 bytes. Putting `onkeyup` first saved another 18 bytes despite identical source length and behavior.
- Explicit callback guarding cost 11 bytes versus optional invocation. Folding the held-state assignment into its callback condition cost 10 bytes.
- Registering handlers at module load cost 1 byte, looping over the two listener names cost 17 bytes, and storing held state on callback functions cost 33 bytes.
- Using the event type's truthy sixth character cost 1 byte; comparing its length was neutral. Arrays used as the held-key and callback maps cost 21 and 1 bytes respectively.

## Measured ship and station refactor experiments

`build:slow`*, seed `13312`, against the September 2026 split of `craft.js` into
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

`build:slow`*, seed `13312`, continuing the ship and station refactor above.
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

`build:slow`*, seed `13312`. Replacing the `lifetime` countdown with health
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

`build:slow`*, seed `13312`, against the `src/ship.js` segment pathing and shape
construction. The retained changes took advzip from 13832B to 13809B (and
`build:full`* from 13831B to 13807B).

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

`build:slow`*, seed `13312`, against `src/shrapnel.js` and `src/particles.js`.
The retained changes took advzip from 13809B to 13745B (and `build:full`* from
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

## Measured collision metadata experiment

`build:fast`, seed `13312`, against the current collision implementation.
- Replacing the one-use `aParts`/`bParts` aliases in `hit()` with optional indexed
  access (`a.parts?.[aIndex]` and `b.parts?.[bIndex]`) saved 15B after advzip
  (13334B -> 13319B). The equivalent world-generation alias removal cost 1B and
  was reverted.

## Measured wreck max-speed experiment

`build:fast`, seed `13312`, against the 2026-09-07 zero-thrust wreck behavior.
- Changing `Ship.maxSpeed` from a cockpit ternary to
  `(this.cockpit && 17 * this.forwardThrust) || 180` lets intact wrecks with no
  thrusters use the same finite fallback speed as debris, so shove velocity is
  no longer always treated as over-speed. Kept: it saved 1B after advzip
  (13499B -> 13498B). `npm run test:docked` passed; focused
  `npx eslint src/ship.js` passed. Full `npm run lint` is blocked by
  unrelated `.sky-preview-profile/prefs.js` `user_pref` globals.

## Measured camera, momentum, mining and sizing experiments (2026-09-07)

`build:fast`, seed 13312, 10 advzip iterations. Camera tracking, collision
resolution, mining and viewport sizing had no file-specific experiment notes.
Retained total: **13493 -> 13468B (-25B)**.

| Candidate | Advzip before -> after | Outcome |
| --- | --- | --- |
| `camera.js`: use `Math.hypot(x / halfWidth, y / halfHeight)` for oval distance | 13493 -> 13473B | Retained, -20B |
| Camera: combine docked/deadzone movement into one clamped easing factor | 13473 -> 13479B | Reverted, +6B |
| `mining.js`: read tip coordinates from `hitbox` instead of copying into surface metadata | 13473 -> 13478B | Reverted, +5B |
| `set-sizing.js`: destructure window dimensions once | 13473 -> 13477B | Reverted, +4B |
| `resolve.js`: default missing momentum to `{ x: 0, y: 0 }`, then read coordinates directly | 13473 -> 13468B | Retained, -5B |
| Mining: derive `segment` from `hitbox` instead of copying into surface metadata | 13468 -> 13485B | Reverted, +17B |

Momentum methods return vectors with both finite numeric coordinates; only an
absent method needs the zero-vector fallback. Revisit if partial vectors become
valid. Collision/bounce tests passed. Camera equivalence passed 2,016 cases
covering docking, viewport sizes, timesteps and positions inside/on/outside the
oval, within 1e-9 coordinate tolerance.

## Measured collision damage threshold experiments (2026-09-07)

`build:fast`, seed 13312, 10 advzip iterations, baseline 13468B. All
attempts below were reverted; the original fractional damage and mass cutoff
remained in place at the end of that experiment.

| Candidate in `resolve.js` | Advzip before -> after | Cost |
| --- | --- | --- |
| Remove `dentingMass` and force guard; use `Math.floor(force / 2000)` with `amount` guards at both damage calls | 13468 -> 13469B | +1B |
| Same with divisor 400 | 13468 -> 13469B | +1B |
| Floor with divisor 2000 and one shared `if (amount)` guard | 13468 -> 13474B | +6B |
| Preserve existing damage/mass rules but calculate amount first and guard `amount > 0` | 13468 -> 13482B | +14B |

Flooring with divisor 2000 moves the first damaging force from above 400 to
2000, failing the existing 100-unit/s ship/rock damage test. Divisor 400
passes existing tests but changes that impact from about 0.23 damage to 2.
For a mass-9 ship against a mass-900 station, first damage moves from above
44.89 to 224.44 units/s of normal closing speed with divisor 2000. A mass-6
item becomes damaging at about 555.56 units/s instead of being exempt.
These are per-contact thresholds, not a whole-collision damage prediction.
Do not floor `(force - 400) / 2000` without a clamp or positive guard:
negative damage heals. Keep zero-amount calls guarded too, because `damage`
also propagates destroyed hull state to mounts.

## Measured fallback and canvas experiments

Before retrying redundant item updates, glint save/restore, glow-cache guards,
mount-coordinate defaults, canvas assignment ordering, or single-element loops,
read [September fallback and canvas experiments](fallback-and-canvas.md).
The 2026-09-06 pass measured each candidate with `build:fast` and retained
**13346 -> 13320B (-26B)**. The reference records individual wins, rejected
attempts, and the invariants that make the deletions safe.

## Force-only collision damage (2026-09-07)

User-requested gameplay simplification: remove `dentingMass` and both opposing
mass checks, retaining `force > 400` and fractional `(force - 400) / 2000`
damage. `build:fast`, seed 13312, 10 advzip iterations:
**13468 -> 13483B (+15B)**. Retained for gameplay despite the size cost.
This supersedes the mass cutoff retained in the earlier threshold experiments.

Mass already scales the normal impulse. Against a mass-9 ship, a mass-6 item
causes no damage at 100 units/s closing speed and 0.16 damage at 200 units/s.
Collision/bounce tests pass, including these cases with both contact orderings.
Targeted lint passes; repository lint fails on 40 pre-existing `user_pref`
no-undef errors in `.sky-preview-profile/prefs.js`.

## Rounded collision damage (2026-09-07)

`build:fast`, seed 13312, 10 advzip iterations, against the existing
force-only collision-damage version (13459B):

| Candidate in `resolve.js` | Advzip before -> after | Outcome |
| --- | --- | --- |
| Assign rounded damage in the `if` condition, guarding zero damage | 13459 -> 13456B | Retained, -3B |
| Derive `bounce` in one ternary instead of assigning after a speed guard | 13456 -> 13472B | Reverted, +16B |

Damage was `Math.round((force - 400) / 2000)` at the end of this experiment. The zero-damage guard remains:
calling `damage` with zero can still propagate destroyed-hull state to mounts.
Collision/bounce tests pass. Targeted lint passes; repository lint still fails
only on the pre-existing `user_pref` globals in `.sky-preview-profile/prefs.js`.

## Steeper rounded collision damage (2026-09-07)

Gameplay change: use `Math.round((force - 400) / 1200)` so heavy impacts
cause more damage while a mass-6 item hit head-on at the starting ship's
272-speed cap remains zero (`0.483` before rounding). A radius-100 asteroid
now deals 2 rather than 1 damage in that same hit.

## Unused production glyphs (2026-09-07)

`build:fast`, seed 13312, 10 advzip iterations: omitting the unused
`!%(),.:>JZ` glyph paths in production retained character-code alignment and
reduced advzip from **13411B to 13361B (-50B)**. The production UI still uses
all digits, `$`, `*`, `+`, `-`, `/`, lowercase `m`, and the remaining capital
letters. `!%(),:>JZ` are retained between `@ifdef DEBUG` blocks for the debug
text/FPS demos, with matching `@ifndef DEBUG` comma placeholders in production;
the added preprocessor support has no production ZIP cost (13361B unchanged).
`.` remains entirely unused.

## Asteroid max-speed removal (2026-09-07)

User-authorized gameplay change: deleting `Asteroid.maxSpeed` lets asteroids
use `move`'s existing 272-speed default instead of settling toward 70. Ordinary
drag still applies. `build:fast`, seed 13312, 10 advzip iterations, reduced
advzip from **13361B to 13357B (-4B)**. Collision/bounce tests and lint pass.


## World, station and lighting retry sweep (2026-09-07)

Sequential build:fast measurements, seed 13312, 10 advzip iterations.
Roadroller: abbreviations 32, learning rate 2501, max count 4, reciprocal base
count 40, precision 16, selectors [0,1,2,3,5,6,7,11,13,42,53,281].
Changed source and encoder settings justified retrying old losses.
Final confirmed advzip: **13443 -> 13424B (-19B)**.

| File / candidate | Advzip before -> after | Status |
| --- | --- | --- |
| world: merge spike spreads | 13443 -> 13449B (+6B) | Reverted |
| world: scatter helper retry | 13443 -> 13437B (-6B) | Retained |
| world: inline item count | 13437 -> 13437B (0B) | Reverted |
| world: inline gem count | 13437 -> 13435B (-2B) | Retained |
| station: reuse glow vertices for bay halves | 13435 -> 13437B (+2B) | Reverted |
| station: flatMap core rotation | 13435 -> 13434B (-1B) | Retained |
| lighting: reuse pointBetween for mix | 13434 -> 13429B (-5B) | Retained |
| lighting: inline tint parse locals | 13429 -> 13428B (-1B) | Retained |
| lighting: glow game scale retry | 13428 -> 13424B (-4B) | Retained |

The scatter helper previously cost 5B; using game.scale previously cost 17B.
Both now save bytes. Scatter preserves random-call and placement order.
Core rotation returns one point, so flatMap preserves coordinates and order.
pointBetween uses identical channel arithmetic; all mix calls supply amount.
Inline parsing adds work during cached tint-table creation only, not per frame.
The glow refresh sets cache.scale to game.scale before drawing, so the two
divisors are identical in this synchronous function.

Behavior checks passed: complete world blueprint deep equality for seeds
0, 1, 42, 13312 and 20260907; exact station corral data equality; 3015 tint
comparisons covering all palettes/wear levels and ramp samples including
clamp boundaries; identical mocked docking glow canvas commands at scales
1, 1, 0.5, 2, 2 (creation, reuse and zoom invalidation). Temporary harness
bundled original/current modules with unrelated browser initialization stubbed.
Lint and final build:fast passed.


## Follow-up helper and single-use value sweep (2026-09-07)

Same build:fast, seed 13312, 10 advzip iterations and Roadroller parameters as
the preceding world/station/lighting sweep. Fresh baseline 13424B. Twenty
candidates measured independently against the retained source; final advzip
**13424 -> 13420B (-4B)**, including import-order lint fixes.

| File / candidate | Advzip before -> after | Status |
| --- | --- | --- |
| item: replace Vector radius with hypot retry | 13424 -> 13443B (+19B) | Reverted |
| shrapnel: inline spark pace | 13424 -> 13425B (+1B) | Reverted |
| shrapnel: inline tail coordinates | 13424 -> 13425B (+1B) | Reverted |
| polygon: inline radius wander | 13424 -> 13444B (+20B) | Reverted |
| local-movement: inline rotated point | 13424 -> 13441B (+17B) | Reverted |
| asteroid: flatten leaves with flatMap retry | 13424 -> 13449B (+25B) | Reverted |
| asteroid: single map for leaf branch | 13424 -> 13446B (+22B) | Reverted |
| asteroid: inline child mass | 13424 -> 13454B (+30B) | Reverted |
| asteroid: inline child contents | 13424 -> 13433B (+9B) | Reverted |
| vector: share directionOf with movePoint | 13424 -> 13424B (0B) | Reverted |
| camera: inline oval half dimensions | 13424 -> 13424B (0B) | Reverted |
| collisions: inline edge key helper | 13424 -> 13425B (+1B) | Reverted |
| collisions: inline placePoints helper | 13424 -> 13441B (+17B) | Reverted |
| background: use integer truncation for sparkle palette index | 13424 -> 13432B (+8B) | Reverted |
| background: inline dot color preserving random order | 13424 -> 13428B (+4B) | Reverted |
| distribute: inline overlap flag | 13424 -> 13424B (0B) | Reverted |
| ship: inline activation duration | 13424 -> 13427B (+3B) | Reverted |
| vector: reuse length for distanceTo | 13424 -> 13444B (+20B) | Reverted |
| polygon/item/asteroid/lighting: share radiusOf across three origin-radius calculations | 13424 -> 13420B (-4B) | Retained |
| lighting: reuse radiusOf for offset shape reach | 13420 -> 13422B (+2B) | Reverted |

The recent interpolation-helper win motivated sharing the three identical
origin-radius calculations. This saves bytes where the standalone item hypot
retry does not. All production vertices supply two numeric coordinates, so
removing the item's intermediate Vector allocation preserves its radius.
The offset shape-reach extension added an intermediate point-array allocation
and cost bytes; reverted. No other candidate retained.

Checks: 1001 radius cases match both original implementations exactly; prior
world/station/lighting comparison harness still passes (five world seeds,
station geometry, 3015 tint samples and glow cache/zoom canvas commands).
Collision, docked inventory/damage/repair/scoop/flight, and prism suites pass.
Lint passed after fixing import order; final build confirmed 13420B.


## Fixed item and docking-glow radii (2026-09-07)

User suggested fixed bounds instead of radiusOf. Same build:fast settings,
seed 13312 and 10 advzip iterations as the preceding sweeps.

| Candidate | Advzip before -> after | Status |
| --- | --- | --- |
| Docking glow fixed radius 280 | 13420 -> 13417B (-3B) | Retained |
| Per-item constants: amethyst 7, diamond sqrt(40), gold sqrt(65), message sqrt(74); remove Item radius assignment | 13417 -> 13448B (+31B) | Reverted |
| Item radius fallback 9, preserving opal radius 6 | 13417 -> 13432B (+15B) | Reverted |

Final confirmed 13417B. Item keeps radiusOf: per-type constants cost bytes,
and a shared bound also costs bytes while enlarging polygon-item glints.
The only docking glow outline is the station bay, shared by both halves.
Its measured origin radius is 278.6124952330746. Fixed 280 contains every
vertex and preserves at least the former blur padding, checked against actual
station geometry at scales 0.01, 0.1, 0.5, 1, 2 and 10. The cached canvas
is slightly larger; cache invalidation and drawing logic are unchanged.
Future bay geometry or new glow shapes must remain inside this bound or update
it. Lint and final build:fast passed. No item-definition edits retained.


## Remove obsolete credit pickups (2026-09-07)

User requested removal after money-cache items were disabled. Deleted the
item.item.credits lookup, direct account increment and dollar FOUND notice
branch from scoop.js. Deleted the commented-out items/cache.js definition and
removed its stale item-schema documentation. Repository search found no other
credit-pickup paths; starting credits, HUD balance, buying, selling and repairs
remain active and necessary.

Same build:fast settings, seed 13312 and 10 advzip iterations: advzip
**13417 -> 13391B (-26B)**. Retained. Lint and docked regression suite passed.
Six temporary direct scoop checks passed: ordinary cargo, full hold, message,
paint unlock, item outside throat and duplicate contacts. All preserve account
balance; normal cargo still requires room, notes are consumed without stowing,
and already-removed items cannot be collected twice.

## Remove message item name (2026-09-08)

The message item is always spawned with an instance `message`, so `scoop()`
reads and removes it without reaching the cargo-name path. With `build:fast`,
changing `name: 'MESSAGE'` to `name: ''` cost 11 bytes (13336B -> 13347B),
while omitting `name` saved 4 bytes (13336B -> 13332B). The omitted property was
retained; message pickup coverage in the docked suite passed.

## Lighting parse all characters (2026-09-07)

Measured with `npm run build:fast`, fixed Roadroller settings/seed 13312 and
10 advzip iterations. Baseline 13392B.

- Parsing every palette entry with `shades.map(parse)` in `shadeOf`: 13397B
  (+5B), reverted.
- Parsing every character with `[...color].map(...)`, including the unused
  `NaN` channel from `#`, and dropping that channel with `.slice(1)` after
  formatting: 13388B (-4B), retained. The unused channel passes through
  componentwise blending without affecting RGB; source comments explain why.

Behavior check: 5850 exact before/after tint comparisons across all nine
palettes, all five shade indexes and 130 ramp samples covering every table
step and clamp boundaries. Lint passed.

## Roadroller decoder ZIP golf (2026-09-08)

All measurements use `npm run build:full`, fixed Roadroller settings/seed and
the final advzip output. Baseline, with no decoder post-processing: **13,363B**.
The ZIP, rather than decoder character count, is the metric.

- `h=[0,...]` -> `h=Array(12).fill(0)`: 13,366B (+3B), reverted.
- `.fill(1<<15)` -> `.fill(c/4)`: 13,363B (neutral), reverted.
- `(i==34|i==96)&&i` -> `i%62==34&&i`: **13,361B (-2B)**, retained. `i` is a
  seven-bit decoded character, and the expressions match for the two quote
  delimiters (34 and 96).
- Remove the unused nested `[...e].map` callback argument: 13,366B (+3B),
  reverted.
- `i=i*2+d` -> `i+=i+d`: 13,363B (neutral), reverted.

The retained decoder produced the same captured decoded-program SHA-256 as the
baseline: `67bae1a4a7fe160e0562b12776f9c9efe58c579c4aad639657c8b6665ff685a1`.
Lint passed.

### Broader decoder sweep (2026-09-08)

User-requested `build:full` comparisons, unchanged encoder parameters and 6000
advzip iterations. Baseline includes the quote modulo rewrite: **13,361B**.
Every candidate below passed decoded-string equality before measurement and
again on its generated build. Individual measurements are against that baseline.

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| Remove unused `o=` from prediction update | 13362 | +1 |
| Count array via `a.slice().fill(0)` | 13365 | +4 |
| Weights via `new Float64Array(12)` | 13373 | +12 |
| Wrap decoder in `with(Math)` and omit `Math.` | 13363 | +2 |
| Input `x*64` -> `x<<6` | 13361 | 0 |
| Prediction `a[e]*2+1` -> `(a[e]<<1\|1)` | 13363 | +2 |
| Numerator `~-c` -> `(c-1)` | 13360 | -1 |
| Remove outer `\|0` from history hash step | 13359 | -2 |
| History fallback `(n[t-e]\|0)` -> `(n[t-e]\|\|0)` | 13362 | +1 |
| Bit append `i=i*2+d` -> `i=2*i+d` | 13361 | 0 |
| Expansion `with(r.split(a))r=join(shift())` -> `r=r.split(a),r=r.join(r.shift())` | 13360 | -1 |
| Remove only nested map callback body parentheses | 13361 | 0 |
| Remove inner history fallback: `(n[t-e]\|0)` -> `n[t-e]` | 13359 | -2 |
| Count base `1/40` -> `.025` | 13361 | 0 |
| Denominator `1+Math.exp(C)` -> `Math.exp(C)+1` | 13360 | -1 |
| Bit append -> `i=i<<1\|d` | 13361 | 0 |
| History hash via `reduce` | 13369 | +8 |
| User suggestion `o=a[e]*2+1` -> `o=a[e]+a[e]+1` | 13361 | 0 |

Interaction checks (all deltas relative to 13361B):

- Numerator + outer hash truncation removal: 13360B (-1).
- Those two + expansion rewrite: 13358B (-3); denominator reordering was neutral.
- Numerator + expansion rewrite: 13359B (-2).
- Outer hash truncation removal + expansion rewrite: 13359B (-2).
- Inner history fallback removal + numerator: 13358B (-3); denominator
  reordering was neutral.
- **Inner history fallback removal + expansion rewrite: 13357B (-4), retained.**
  Adding the numerator rewrite, or both numerator and denominator reordering,
  remained 13357B, so these extra changes were omitted.
- Repeated-addition prediction + retained pair: 13358B (-3); adding the numerator
  rewrite remained 13358B. Repeated addition was therefore omitted.

The retained history simplification relies on descending selector offsets:
missing history entries form a prefix while the hash accumulator is still zero,
so the outer `|0` already converts their NaN to zero. The postprocessor verifies
this ordering before applying the replacement. Removing the outer truncation
instead needs a separate exact-integer bound for short selectors, so it was not
retained. Postprocessing now operates on `secondLine` only, leaving the encoded
payload untouched.

Final build confirmed **13,361 -> 13,357B (-4B)**. The built decoder and original
Roadroller decoder produced identical strings in Node/V8 and Firefox 155.0.1,
with the SHA-256 above. Four additional small fixtures (quotes, template strings,
Unicode and repeated abbreviations) also decoded identically in Node. Chrome
was not installed; V8 was exercised through Node. Lint passed.

### Additional decoder suggestions (2026-09-08)

Individual `build:fast` comparisons, unchanged encoder settings, 10 advzip
iterations; baseline **13,348B**. No candidates retained.

| Candidate | advzip bytes | Delta | Captured decoded program |
| --- | ---: | ---: | --- |
| Comma-delimited selectors, separate `C=0` | 13350 | +2 | Identical |
| Array of selector strings | 13350 | +2 | Identical |
| Nested numeric arrays, remove `[...e]` | 13349 | +1 | Identical |
| Count table Uint8Array -> Uint16Array | 13346 | -2 | Identical |
| Remove prediction update shifts, truncate division with `\|0` | 13344 | -4 | Different: rejected |

Checks captured the complete eval argument in Node/V8 without running the game.
The Uint16 count table preserves counts (0–4), but adds 51,000,000 bytes of live
array storage (153 MB -> 204 MB total); omitted for this disproportionate cost.
The floating-point experiment was a local update simplification, not a codec
redesign; the latter needs matching encoder changes and further investigation.

Roadroller explicitly omits an EOF symbol because output length is known.
Removing `t<32119` loses termination; EOF detection needs encoder changes.
There is no standalone `r=a=` cleanup in this build: abbreviation expansion
already overwrites r with the output string and a with regex matches, finally
null. These assignments are functional and cannot simply be deleted.

Follow-up: the user explicitly accepted the additional 51 MB of memory.
Retained the Uint8Array -> Uint16Array decoder postprocessing change. Fresh
`build:fast` comparison confirmed **13,348 -> 13,346B (-2B)**. Both generated
tables use Uint16Array; complete decoded programs are identical in Node/V8
(SHA-256 `3d25f4c9fb6b06661e212193fa3efccd5c0a4966487c7972fa112c63e8d3948a`).
Lint passed.

Selector-guard follow-up: user requested `build:full` measurement with the
Uint16 count table retained. With the selector validation and inner history
fallback removal: **13,342B**; without that entire block: **13,343B**.
Thus the guarded rewrite currently saves **1B** (6000 advzip iterations).
Restored the block. The selectors variable and every calls run only at build
time; only the resulting removal of the inner `|0` affects the shipped decoder.


### Further decoder sweep (2026-09-08)

`build:fast`, unchanged encoder settings, 10 advzip iterations. Baseline includes
the Uint16 count table: **13,346B**. All measured candidates passed complete
decoded-program equality in Node/V8 before and after their build.

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| `constructor` | 13353 | +7 |
| `alias_constructor` | 13347 | +1 |
| `count_first` | 13350 | +4 |
| `destructure_expansion` | 13343 | -3 |
| `splice_expansion` | 13343 | -3 |
| `quote_ternary` | 13346 | +0 |
| `mask_modulo` | 13348 | +2 |
| `state_ternary` | 13347 | +1 |
| `state_factored` | 13347 | +1 |
| `count_increment` | 13346 | +0 |
| `byte_assign` | 13346 | +0 |
| `fill_decimal` | 13346 | +0 |
| `scale_decimal` | 13346 | +0 |
| `hash_mask` | 13346 | +0 |
| `match_expansion` | 13346 | +0 |
| `destructure_match` | 13344 | -2 |
| `destructure_numerator` | 13343 | -3 |
| `destructure_denominator` | 13344 | -2 |
| `splice_numerator` | 13346 | +0 |
| `splice_denominator` | 13343 | -3 |
| `destructure_loop` | 13344 | -2 |
| `splice_loop` | 13344 | -2 |
| `destructure_count` | 13348 | +2 |
| `destructure_byte` | 13345 | -1 |
| `scale_power` | 13347 | +1 |
| `quote_bit_safe` | 13349 | +3 |

Retained **destructure_expansion** only: replace
`r=r.split(a),r=r.join(r.shift())` with
`[a,...r]=r.split(a),r=r.join(a)`. The first split element is the abbreviation
replacement; the remaining elements are joined with it. The regex match in a
is no longer needed after splitting, and the next iteration overwrites a.
Final rebuild confirmed **13,346 -> 13,343B (-3B)**.

Candidate key: constructor uses `new a.constructor`; alias_constructor stores
Uint16Array in a while allocating r first; count_first uses `a=r.slice().fill(...)`.
splice_expansion uses `r=r.splice(1).join(r[0])`. match_expansion uses r.match
instead of regex.exec; loop variants move joining into the for update clause.
Numerator and denominator interactions retry previous neutral simplifications
against the new expansion layouts. Other changes: modulo -> bit mask; rANS
state branch/factor rewrites; count saturation -> ternary preincrement; byte
subtraction -> XOR; decimal fill/scale constants; reordered hash mask; scale
via exponentiation; quote boolean multiplication -> ternary or shifts.
The unparenthesized quote shift candidate failed output equality and was not
built; quote_bit_safe corrects its precedence but costs 3B. All other candidates
were reverted, including equally sized alternatives to the simpler retained one.

The retained transform also passed four fixtures covering quotes, templates,
Unicode, control escapes and repeated abbreviations in Node/V8. Lint passed.
Firefox 155.0.1 also passed the built-program and all four fixture comparisons.
Built decoded SHA-256:
`3d25f4c9fb6b06661e212193fa3efccd5c0a4966487c7972fa112c63e8d3948a`.


### Full-build recheck of neutral decoder candidates (2026-09-08)

User explicitly requested full builds to recheck the fast-build saving and ties.
All measurements use full mode (6000 advzip iterations), unchanged source and
encoder settings. Baseline is the original split-and-shift expansion with Uint16
counts, **13,342B**. Every candidate passed complete decoded-program equality
in Node/V8 before and after its build. Candidate names refer to the sweep above.

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| `baseline` | 13342 | +0 |
| `destructure_expansion` | 13342 | +0 |
| `splice_expansion` | 13342 | +0 |
| `quote_ternary` | 13344 | +2 |
| `count_increment` | 13344 | +2 |
| `byte_assign` | 13342 | +0 |
| `fill_decimal` | 13344 | +2 |
| `scale_decimal` | 13343 | +1 |
| `hash_mask` | 13343 | +1 |
| `match_expansion` | 13343 | +1 |
| `splice_numerator` | 13342 | +0 |
| `destructure_numerator` | 13342 | +0 |
| `splice_denominator` | 13342 | +0 |

No full-build wins. In particular, destructure_expansion and splice_expansion
both save 3B with 10 advzip iterations but **0B** with 6000 iterations. Reverted
the previously retained destructuring rewrite to the original split-and-shift
expansion; no other candidates retained. This supersedes the retention decision
in the preceding fast-build sweep. Full rebuild: **13,342 -> 13,342B (0B)**.
Lint passed.


### Decoder character-sequence reuse sweep (2026-09-08)

User requested further reuse of characters and short sequences. Used full
builds throughout (6000 advzip iterations), unchanged encoder settings, baseline
**13,342B**. Each measured candidate passed complete decoded-program equality
in Node/V8 before and after its build. No parameter search or payload changes.

#### Expression and punctuation rewrites

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| `comma_initializers` | 13343 | +1 |
| `for_initializers` | 13343 | +1 |
| `paired_tables` | 13350 | +8 |
| `copy_then_fill` | 13347 | +5 |
| `table_length` | 13347 | +5 |
| `fill_shift` | 13343 | +1 |
| `count_subtract` | 13343 | +1 |
| `prediction_inline` | 13342 | +0 |
| `prediction_repeat` | 13344 | +2 |
| `prediction_complement` | 13342 | +0 |
| `probability_sign` | 13341 | -1 |
| `weight_subtract` | 13342 | +0 |
| `state_add` | 13342 | +0 |
| `state_subtract` | 13343 | +1 |
| `bit_compare` | 13343 | +1 |
| `quote_and` | 13343 | +1 |
| `quote_compare` | 13342 | +0 |
| `quote_nested` | 13341 | -1 |
| `hash_complement` | 13343 | +1 |
| `renormalize_shift` | 13343 | +1 |
| `input_modulo` | 13343 | +1 |
| `input_multiply` | 13342 | +0 |
| `selectors_double` | 13341 | -1 |
| `selectors_template` | 13342 | +0 |
| `nested_split` | 13343 | +1 |
| `split_loop` | 13341 | -1 |
| `weights_map` | 13351 | +9 |

#### Callback-local identifier reuse

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| `index_x` | 13339 | -3 |
| `index_y` | 13340 | -2 |
| `index_M` | 13341 | -1 |
| `index_p` | 13341 | -1 |
| `context_x_index_y` | 13340 | -2 |
| `context_y_index_x` | 13340 | -2 |
| `context_p_index_x` | 13339 | -3 |
| `context_M_index_x` | 13342 | +0 |

#### Interactions with callback index x

| Candidate | advzip bytes | Delta |
| --- | ---: | ---: |
| `index_x_sign` | 13339 | -3 |
| `index_x_quote` | 13340 | -2 |
| `index_x_sign_quote` | 13340 | -2 |
| `index_x_selectors` | 13340 | -2 |
| `index_x_sign_selectors` | 13340 | -2 |
| `index_x_quote_selectors` | 13340 | -2 |
| `index_x_sign_quote_selectors` | 13340 | -2 |
| `index_x_loop` | 13341 | -1 |
| `index_x_sign_loop` | 13342 | +0 |
| `index_x_quote_loop` | 13341 | -1 |
| `index_x_sign_quote_loop` | 13342 | +0 |
| `index_x_selectors_loop` | 13341 | -1 |
| `index_x_sign_selectors_loop` | 13341 | -1 |
| `index_x_quote_selectors_loop` | 13341 | -1 |
| `index_x_sign_quote_selectors_loop` | 13341 | -1 |

Retained only **index_x**: change the callback-local index U to x, preserving
identifier length and reusing the rANS state spelling. These callback bodies
never read the outer x, so lexical shadowing is safe. Word-boundary matching
leaves Uint16Array intact. Full rebuild: **13,342 -> 13,339B (-3B)**.

Distinct decoder character-sequence counts (length 1/2/3/4) change from
61/378/508/552 to 61/376/508/552. U still occurs in Uint16Array; the win removes
two distinct bigrams, not a character from the overall alphabet. Reducing these
counts alone does not ensure smaller DEFLATE: comma_initializers removed one
distinct four-character sequence but cost 1B.

Four other isolated rewrites saved 1B: probability_sign changes C-= to C+= and
negates C in Math.exp; quote_nested uses i==f?0:f; selectors_double switches the
selector string to double quotes; split_loop moves join into the for update.
All 15 nonempty combinations of these with index_x were measured. None beat
index_x alone; only adding probability_sign tied it. All were omitted.
context_p_index_x also tied index_x and was omitted as an unnecessary rename.

The remaining row names describe: initializer punctuation/placement; paired
typed-array construction via map; copying before filling; count-table length
from a.length; fill via c>>2; subtraction-based saturation; prediction assignment
nesting/repetition or complement arithmetic; weight/state sign rewrites; bit
comparison order; quote logic; complement hash mask; shifted renormalization
condition; modulo input masking; input multiplication order; template selectors;
nested split assignment; and weight initialization via map.

Final decoder and four fixtures (quotes/templates, Unicode, repeated
abbreviations and control escapes) decoded identically in Node/V8 and Firefox
155.0.1. Built decoded SHA-256:
`3d25f4c9fb6b06661e212193fa3efccd5c0a4966487c7972fa112c63e8d3948a`.
Lint passed.
