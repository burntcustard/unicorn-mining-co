# Golfing sweep — 2026-09-07

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
