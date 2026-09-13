# Golfing sweep — 2026-09-07

## Cargo scatter — 2026-09-08

Settings: `npm run build:fast`, seed 13312, 10 advzip iterations.
Each candidate was measured independently against 13326B.

| Candidate | Advzip after | Status |
| --- | --- | --- |
| Direct velocity and spin arithmetic | 13329B | Reverted (+3B) |
| directionOf(angle).scale(30) | 13361B | Reverted (+35B) |
| Shared scatter helper across four ship impulse sites (retry with new cargo caller) | 13360B | Reverted (+34B) |
| rotatePoint(Vector(30), angle) | 13327B | Reverted (+1B) |
| Set inherited spin before velocity | 13329B | Reverted (+3B) |
| Uniform random angle centred on zero | 13332B | Reverted (+6B) |
| Remove inherited ship spin, as requested by user | 13323B | Retained (-3B) |

The retained gameplay change leaves each item's existing spin plus the small
random impulse; ship spin is no longer copied. Outward force remains 30.
Docked tests cover cargo and multiple messages in normal and production-mangled
bundles, checking release, outward impulse and spin bounds.

Settings: `npm run build:fast`, seed 13312, 10 advzip iterations. Candidates tested individually against the retained baseline. **13457 → 13437 bytes (-20 bytes)**. No gameplay approximations retained.

| File | Candidate | Advzip before → after | Result |
| --- | --- | --- | --- |
| `src/ship.js` | remove zero rotational thrust target branch | 13457 → 13470 | Reverted (+13B) |
| `src/ui/docked.js` | merge menu entry transitions | 13457 → 13449 | Retained (-8B) |
| `src/prism.js` | reuse vector rotation in outlineOf | 13449 → 13457 | Reverted (+8B) |
| `src/asteroid.js` | share total leaf count | 13449 → 13450 | Reverted (+1B) |
| `src/collisions.js` | map polygon projections into min max | 13449 → 13460 | Reverted (+11B) |
| `src/ship.js` | filter healthy thrust segments before reducers | 13449 → 13444 | Retained (-5B) |
| `src/prism.js` | center fractions with preserved call parentheses | 13444 → 13450 | Reverted (+6B) |
| `src/asteroid.js` | flatMap boundary edges using filter then map | 13444 → 13463 | Reverted (+19B) |
| `src/collisions.js` | boundary uniqueness using first and last indexes | 13444 → 13452 | Reverted (+8B) |
| `src/ship.js` | share cockpit survival lookup | 13444 → 13446 | Reverted (+2B) |
| `src/ui/docked.js` | remove redundant cargo stage guard | 13444 → 13441 | Retained (-3B) |
| `src/prism.js` | vector subtraction for intersection edge | 13441 → 13444 | Reverted (+3B) |
| `src/asteroid.js` | share centroid divisor | 13441 → 13447 | Reverted (+6B) |
| `src/asteroid.js` | flatten leaves using flatMap | 13441 → 13444 | Reverted (+3B) |
| `src/prism.js` | map spectrum shade literals | 13441 → 13448 | Reverted (+7B) |
| `src/collisions.js` | neighbor offsets forEach | 13441 → 13443 | Reverted (+2B) |
| `src/ui/docked.js` | clamp sale selection with existing Math.max idiom | 13441 → 13458 | Reverted (+17B) |
| `src/prism.js` | branchless face normal orientation | 13441 → 13437 | Retained (-4B) |

Collision/bounce and docked inventory/menu/damage/repair/scoop/flight suites pass. Prism passes 360 traced/rendered frames and corner regressions after the final change. Targeted lint passes; full lint fails on pre-existing `user_pref` references in `.sky-preview-profile/prefs.js`.

Thrust filtering preserves order and contributions. Menu entry resets module selection only at stage zero and calculates action focus after advancing. `cargoMenu` implies nonzero stage. Prism constructs the same normalized normal only for valid intersections, then multiplies by ±1. No computed property keys were introduced.

An initial fraction-centering trial accidentally removed call parentheses; its measurement was discarded and the corrected version measured separately above.

## Power removal with preserved launch motion

Fresh restored-source baseline, `npm run build:fast`, seed 13312, 10 advzip
iterations: **13494 -> 13411B (-83B)**. This supersedes the unsuccessful earlier
power-removal attempt, which reduced acceleration without the launch speed cap.

Removed module powerUsage/PWR display, segment power and supply(), and the
per-nozzle thrust allocation/reduction. The single engine mount permits reading
thrust from its healthy fitted module. A launch-only throttle getter sets nozzle
activation to half during the existing two-second coast; its square preserves
the original quarter thrust and speed cap. Steering retains both original coast
factors. Ordinary flight and the final timer-expiry burn remain unchanged.
Flare/glow now use activation alone; they ease into/out of the half-size coast
rather than applying an immediate independent multiplier.

| Candidate | Advzip before -> after | Status |
| --- | --- | --- |
| Power removal, engine lookup through mounts, preserved launch factors | 13494 -> 13425B | Retained (-69B) |
| Inline single-use rotational getter | 13425 -> 13440B | Reverted (+15B) |
| Find healthy fitted engine in inventory | 13425 -> 13417B | Retained (-8B) |
| Remove zero-thrust target-spin branch (zero approach step already preserves spin) | 13417 -> 13411B | Retained (-6B) |

Restoring the former per-segment `power` channel to make the coast-to-full
transition immediate was measured separately at **13443 -> 13479B (+36B)** and
reverted. The retained launch throttle already produces half-size coast flares
and selects full throttle on the final active frame when `flyOut` clamps the
timer to zero.

Docked regression tests now compare every frame of launch speed, distance and
speed cap against the original equations for all four equipable engines (240
frames each), plus steering over 180 frames each. They verify half-active coast
nozzles and zero thrust from broken/removed engines, both bundled and production
mangled. Collision and prism suites pass. Source/tests lint passes; full lint
still reports existing user_pref errors in .sky-preview-profile/prefs.js.

## Structural sweep — 2026-09-13

Settings: `npm run build:fast`, seed 13312, 10 advzip iterations. Candidates
measured one at a time, each against the running total. **13341 -> 13294B
(-47B).** Lint clean, all four test suites pass.

| File | Candidate | Advzip before -> after | Status |
| --- | --- | --- | --- |
| `src/prism.js` | drop `runsOf`'s `step` vector, testing `last?.out` directly | 13341 -> 13333 | Retained (-8B) |
| `src/prism.js` | remove one of `insidePath`'s two identical `strip(run)` subpaths | 13333 -> 13332 | Reverted (-1B, not worth the winding risk) |
| `src/ui/controls.js` | box rect + key underline as one `Path2D`, one `outline`/`stroke` | 13333 -> 13318 | Retained (-15B) |
| `src/asteroid.js` | replace child `triangles` with `props.mass` as pre-split flag + `lone` | 13318 -> 13341 | Reverted (+23B) |
| `src/asteroid.js` | pass the parent-frame `triangles` unrebased (only its length is read) | 13318 -> 13313 | Retained (-5B) |
| `src/ui/docked.js` | shared `rowText(text, x, y, color, align)` helper over 5 `renderText` sites | 13313 -> 13337 | Reverted (+24B) |
| `src/ship.js` | shared `spawn(origin, segments, own, away)` for `detach`/`fracture` | 13313 -> 13298 | Retained (-15B) |
| `src/modules/thruster-dual-md.js` | match the other three variants' key order | 13298 -> 13294 | Retained (-4B) |
| `src/sound.js` | `for` loop over `getChannelData` instead of `.forEach` | 13294 -> 13304 | Reverted (+10B) |
| `src/main.js` + `src/ship.js` | reuse `lamp.prism` for buried cargo instead of a second `traceBeam` | 13294 -> 13309 | Reverted (+15B) |

Notes and invariants:

- `runsOf`'s `step` was only ever tested for truthiness, and `subtract()`
  returns an object, so a zero-length step was already truthy. `ray.out` exists
  whenever `ray.hit` does, so `last?.out` is the same guard.
- The duplicate `strip(run)` in `insidePath` changes winding relative to the
  extended strip it overlaps, so its 1B is not worth a fill-rule regression that
  automated tests cannot see. Left alone deliberately.
- `Asteroid`'s constructor only reads `props.triangles[1]` for a pre-split
  child, so the rebasing `.map(local)` was dead work. Replacing the collection
  outright with `props.mass` as the pre-split indicator plus a `lone` flag, and
  moving triangulation into the fresh branch, was a clear **+23B loss** — the
  repeated literal branch compresses better than the restructure saves. Don't
  retry.
- `Ship.spawn` keeps mount detachment (destroyed/forget/fit) and hull grouping
  (`outerEdges`, `centerOf`) in their callers; only the origin rotation,
  inherited velocity, segment rebasing, `new Ship` and separating impulse moved.
  `own` is a plain object, not a callback, since neither caller varies it per
  segment. `detach` captures `partsOf(mount)` before `fit(0, mount)` clears the
  mount, but the copies are made afterwards, which is safe: `fit` only mutates
  the mount and the module link, never the segment objects.
- The docked row-text helper is a measured loss; so is the thruster factory
  (already recorded at +56B in audio-and-collision.md). Aligning the dual-MD
  literal's key order with the other three thrusters is the only win there.
- Reusing `lamp.prism` for the buried-cargo clip is a real runtime win (one
  fewer 64-ray trace per frame) but needs `segment.prism` cleared to `0` when
  the lamp is unhealthy/off, plus a guard at the `-1` layer, which costs more
  than it saves. Revisit only if frame time, not size, is the goal.
