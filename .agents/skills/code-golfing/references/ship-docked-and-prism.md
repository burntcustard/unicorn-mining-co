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
