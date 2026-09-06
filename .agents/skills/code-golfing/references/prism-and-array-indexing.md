# September 2026 prism and array indexing experiments

All sizes below are advzip results from `npm run build:fast`, fixed seed 13312,
10 iterations. Deltas are against each experiment's then-current retained
baseline, not additive predictions for another source state. User edits occurred
between some earlier turns; use the explicitly stated before/after pairs.

## Prism correctness constraints

The confirmed recurring split was a strict positive cross-product test in
`joins()`: a straight join gives zero, and roundoff can change its sign as an
asteroid rotates. Mined outlines can retain collinear vertices because their
cleanup uses exact equality. The accepted rule joins same faces or adjacent
outward/straight corners, tolerating signed turn down to
`-1e-8 * before.length() * after.length()`. The tolerance scales with edge
lengths. Real concave corners and non-adjacent exits remain separate.

Preserve that tolerance when golfing. Earlier midpoint-inside and outgoing-ray
direction thresholds produced unwanted splitting. Earlier explanations blaming
normal flips were not established by a reproduction; returning to outline-edge
arithmetic alone did not fix the strict-zero test. Do not treat the earlier
normal-based shortcut as a verified equivalent replacement.

Run `node tests/prism.test.mjs` for prism changes. It checks 360 traced/rendered
frames at several sizes and rotations, plus straight, convex, concave, reversed
face-order and closing-edge cases. It does not reproduce every screenshot or
prove pixel-identical rendering. For collision indexing changes also run
`npm run test:collisions`.

## Retained prism reductions

- Reusing the exit intersection by assigning `out.away` and `out.length` directly
  saved 25B (13361 -> 13336) in the earlier implementation. `Object.assign(out,
  {...})` instead cost 13B in its measured context. This object reuse survived
  the later correction to the corner predicate.
- Inlining the temporary refracted direction into `out.away` was neutral.
- After the confirmed seam fix, constructing the two corner edges with the
  existing `Vector`, spread arguments and `subtract` helpers saved 6B
  (13379 -> 13373), preserving the same cross-product/tolerance formula.
- Passing `(points, from, to)` into `joins()` instead of two entire rays saved
  another 15B (13373 -> 13358). Inlining `sheetOf`'s single-use `feed` was neutral.
- Initializing the nearest entry with `{ at: dir.scale(range), distance: range }`
  removed repeated range/missing-entry checks and saved 7B (13358 -> 13351).
- Using `denom > 0` to orient the exit normal instead of recomputing
  `dir.dot(face) > 0` saved 2B (13351 -> 13349). The denominator is the dot
  product with the unnormalized face normal; positive normalization preserves
  its sign mathematically.
- `run.at(-1)` in `sheetOf` saved 1B (13349 -> 13348); see the broader sweep below.

## Rejected prism experiments

- Removing the unused exit-step vector and guarding only with matching `hit`
  increased ZIP size by 6B despite reducing minified source size.
- Scalar-to-vector corner conversion with unpacked coordinates cost 4B; the
  retained spread/subtract version above was smaller.
- Caching `strip(run)` once for its two `addPath` calls cost 4B. Do not simply
  delete the duplicate subpath: winding contributions can affect overlapping
  paths, so that requires separate rendering validation.
- Reusing `out.distance` for remaining beam length instead of `out.length`
  cost 4B in the earlier context.
- Folding the no-hit path into the refraction guard cost 1B.
- Returning intersection objects directly from `cross()` cost 17B with optional
  nearest-distance access, or 6B when retaining a separate `near` scalar.
- A cross-product helper shared by all five prism uses cost 4B; sharing only
  the three intersection uses cost 9B.
- Adding `hit` and `out` to the entry intersection and returning it cost 9B.
- `found?.distance < entry.distance` cost 2B versus an explicit `found &&` guard.
- Inspecting `dist/minified.js` showed `face` and `span` were not mangled.
  Renaming them to `faceIndex` and `exitSpan` shortened minified JS but cost
  17B and 16B respectively after compression. Browser-reserved property names
  are worth investigating, but mangling alone is not evidence of a ZIP win.
- Folding normal orientation into a signed normalization length cost 4B;
  factoring the sign multiplication cost 21B.
- Returning the final width from `sheetOf()` instead of its side vector cost 2B.

## Production array indexing sweep

The sweep excluded debug/benchmark code and started at 13348B. Only accesses
whose semantics could be preserved were candidates; ordinary `.length` counts,
UI offsets, random indexes and vector `.length()` calls are not tail accesses.

| Change | Measured result |
| --- | --- |
| `runs[runs.length - 1]` -> `runs.at(-1)` | Neutral at 13348B; retained for local consistency |
| Asteroid outline tail `.at(-1)` -> `[outline.length - 1]` | -1B, to 13347B |
| Asteroid previous vertex `.at(i - 1)` -> wrapped modulo indexing | +1B; reverted |
| Same previous vertex -> conditional first/last indexing | +6B; reverted |
| Collision previous edge `.at(i - 1)` -> `[(i + points.length - 1) % points.length]` | -1B, to 13346B |
| All remaining `.at()` calls -> bracket/wrapped indexing as a group | +22B, to 13368B; reverted |
| Reverse spectrum lookup -> `.at(condition ? band : -1 - band)` | +13B; reverted |
| Circular next vertices -> `.at(i + 1 - array.length)` across prism, polygon, collisions and asteroid | +4B; reverted |
| Same circular-next group excluding asteroid | +9B; reverted |

Final retained result: **13348 -> 13346B (-2B)**. Collision tests and prism
regressions passed. Mixed syntax beat universal consistency in this context.

For circular previous-vertex accesses, `i === 0` must wrap to the final element.
For an ordinary missing neighbor, such as `fan[i - 1]`, replacing brackets with
`.at(i - 1)` would incorrectly wrap instead of returning `undefined`. The
collision modulo replacement relies on `points.edges.length === points.length`.
Circular next-vertex `.at(i + 1 - length)` is equivalent only for the loop's
valid index range. Preserve these distinctions when testing future groups.
