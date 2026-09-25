# Collision and physics consolidation

This log records measurements from the same checkout and machine before each
implementation milestone. `src/shared` runs in both the server and the client;
the server calls `updateWorld`, while client prediction calls the same update.

## Milestone 1: baseline and inventory (2026-09-24)

The working tree was clean before this inventory. `npm run build` passed. The
first-frame `index` chunk was 157,613 bytes and 55,880 gzip-level-1 bytes;
the two later chunks were 5,635 and 1,691 raw bytes. Production TypeScript in
`src` occupied 22,207 lines, of which 11,007 were in the Planck-derived
`shared/common`, `shared/collision`, and `shared/dynamics` directories (the
latter count also includes game-owned collision adapters). `test:collisions`
passed.

Three **sequential** runs of `npm run benchmark:simulation`, each with seven
300-operation samples after 120 warm-up operations, gave these median batch
times in milliseconds per operation:

| Work                                | Run 1 | Run 2 | Run 3 |
| ----------------------------------- | ----: | ----: | ----: |
| Shared simulation tick, 43 entities | 2.461 | 2.455 | 2.468 |
| Rollback capture                    | 0.188 | 0.187 | 0.187 |
| Predicted tick with capture         | 2.650 | 2.711 | 2.729 |

An earlier set of parallel benchmark processes was discarded because they
contended for the same CPU. The browser benchmark could not start: its default
`google-chrome` binary is absent, and a filesystem search found no other
Chrome or Chromium executable. The user chose shared benchmarks only, so no
browser binary will be installed for this task. Heap allocation measurement is still needed before changing the
vector and fixture hot paths.

### Entry points and overlapping behavior

| Behavior and implementations                                                          | Callers and current behavior                                                                                                                                                                                                                                                                                                                                                               | Sensitivity and chunk effect                                                                | Owner and decision                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GameCollisions.step` and `World`/`Solver` versus `detectCollisions`/`contactBetween` | `updateWorld` uses the persistent Planck-derived world for all gameplay bodies and contacts; server and client prediction share it. `detectCollisions` is imported only by tests and the diagnostic in the prediction test. Both use the same circle/polygon manifold functions, but the diagnostic has its own pair traversal, filtering, and shape construction.                         | Simulation is hot and in the first-frame chunk; the diagnostic is excluded from production. | `GameCollisions` owns gameplay detection. Keep a read-only overlap query only while diagnostics need it; share collider preparation and narrow-phase rules where doing so preserves query depth and does not mutate the world. |
| `Vector` versus Planck `Vec2`                                                         | Game, renderer, protocol conversion, region logic, and server use `Vector`; Planck common, collision, and dynamics files use `Vec2`. They duplicate construction, copy, add/subtract, scale, length, distance, dot, normalize, and cross-related operations. `Vec2` mutates while `Vector` arithmetic returns new values, so the semantics are not interchangeable without caller changes. | Both ship in the initial chunk. Solver allocation and instruction count are sensitive.      | `Vector` is the game representation. Adapt Planck object-returning uses where measured safe; retain the out-parameter `physics-matrix` operations in solver hot paths.                                                         |
| `physics-matrix` versus `Vec2` methods and `Vector` methods                           | Contact solver, TOI, manifolds, body and shape code use `physics-matrix` to write into existing vectors; other Planck routines allocate `Vec2` objects for equivalent arithmetic.                                                                                                                                                                                                          | Highest allocation sensitivity; matrix code is in the initial chunk.                        | Solver out-parameter helpers remain the owner of mutation-heavy arithmetic. Remove redundant allocating wrappers as their callers migrate.                                                                                     |
| `rotatePoint`/`rotatePoints` and Planck `Rot`/`Transform`                             | Game geometry and craft hitboxes rotate game vectors/outline arrays; Planck shape support, manifolds and sweeps rotate solver values. `rotatePoints` maps full outlines, while `rotatePoint` handles one vector.                                                                                                                                                                           | Hitbox creation happens every tick; solver transforms are hot.                              | Keep game `geometry` API for coordinates; keep necessary internal sweep transforms, but centralize exact equivalent arithmetic after profiling.                                                                                |
| `radiusOf`, `shapeOf`, circle/polygon shape radius                                    | Asteroid/item setup uses maximum distance from origin; craft rendering uses reach from segment midpoint; physics shapes use collision skin and support radii.                                                                                                                                                                                                                              | `radiusOf` and `shapeOf` mostly run at creation; shape radii affect CCD.                    | Preserve distinct meanings. No deletion proposed.                                                                                                                                                                              |
| `move`, `localMovement`, `updateEntities`, `RemoteMotion`, `FramePrediction`          | Shared free motion, parent-carried motion, scheduled simulation subdivisions, presentation interpolation, and partial-tick prediction have different state and time semantics. Server and client prediction use the same shared movement; rendering never writes its interpolated pose to physics.                                                                                         | Movement scheduling is hot; interpolation is render-only.                                   | Preserve the shared movement implementation and the separate presentation path. Consolidate only any exact helper duplication found during later edits.                                                                        |
| Shared procedural `RegionManager` versus server `RegionManager`                       | Shared code owns deterministic region descriptions; server code materializes and sleeps entities.                                                                                                                                                                                                                                                                                          | Outside collision hot path; both server-side.                                               | Preserve separate responsibilities.                                                                                                                                                                                            |
| `outerEdges` versus polygon contact edge marking                                      | `outerEdges` marks visible exterior edges and groups asteroid/craft pieces; polygon contact clipping identifies manifold features.                                                                                                                                                                                                                                                         | Different meanings; first-frame code.                                                       | Preserve both.                                                                                                                                                                                                                 |

An eight-line normalized source-window scan over every `src/**/*.ts` file found
only one literal cross-file duplicate block, shared by circle-polygon and
polygon-polygon Planck contact registration. The table above records the larger
near duplicates that a literal scan cannot find.

### Collider and continuous-contact inventory

`GameObject.hitbox` supplies a circle or polygon. `Craft.hitbox` supplies
segment polygons/circles, docking colliders, cargo mouths, and horn drill tips;
`Asteroid.hitbox` supplies segment polygons; `Item.hitbox` adds a filtered
nonphysical pickup point. `GameCollisions.sync` flattens nested colliders,
skips disabled or degenerate shapes, applies category/mask filters, updates
fixture user data, and rebuilds fixtures when geometry changes. The physical
contact path applies impulses, damage, and collision events. The nonphysical
path reports manifolds and swept contacts to docking, drilling, and cargo
collection without impulses. Any replacement must retain these owner and
segment references, filtering rules, contact points, and fast crossings.

`updateEntities` subdivides visible game movement twice per 30 Hz tick and
keeps a separate distant schedule. Planck's `Solver.solveWorldTOI` finds
multiple time-of-impact contacts inside a physics step; its internal
`maxSubSteps` and `solveIslandTOI` are required for CCD. `World.subStepping`
defaults to false and only changes whether the TOI loop returns after one
impact; it is separate from the game movement subdivision. The 2-metre
Planck translation cap is applied in both ordinary and TOI solver motion.
Existing tests cover a radius-1 body against a thin wall, a rotating thin
solid, physical impulse and torque, trigger crossings, pickup-point filtering,
and rollback. Tests for multiple impacts, higher speeds at the cap, and
moving thin obstacles remain to add.

### Planck reachability and proposed removals

The only game construction of `World` is in `GameCollisions`. It creates
dynamic/kinematic bullet bodies and circle/polygon fixtures; there are no game
joints, edge or chain shapes. The broad phase, dynamic tree, AABB overlap,
circle/polygon contact functions, manifolds, distance support, TOI, solver,
internal TOI substeps, and fixture/body synchronization are reachable and must
remain. `ShapeCast`, its input/output classes, and the separate distance
module's `testOverlap` have no references outside their definitions (the
latter only attaches itself to `Distance`). Their replacement is the retained
TOI and contact pipeline; removal cannot affect a caller. Planck math exports
`nextPowerOfTwo`, `isPowerOfTwo`, `random`, `isFinite`, and its `math` facade
have no source callers; only `EPSILON`, `mod` (sweep), and `clamp` (contact and
Vec2) are used. The unused exports can be deleted. Several deprecated `Vec2`
wrappers have no external callers, but each will be checked against internal
calls during the vector migration. General `World`, `Body`, `Fixture`, and
shape methods are further reduction candidates only after method-level
reachability checks; this inventory does not yet propose deleting them.

### Decision and remaining risks

The initial owner is the existing `GameCollisions`/Planck-derived pipeline.
This avoids choosing a new detection algorithm before behavior and performance
are protected. No production code was changed in this milestone. The absence of a browser benchmark is an accepted measurement limitation;
coarse GC counts provide the allocation comparison for hot-path work.

## Milestone 2: collision architecture protected (2026-09-24)

The gameplay owner remains `GameCollisions` and its Planck-derived broad phase,
manifolds, TOI loop, and solver. Physical colliders receive the solver response;
nonphysical fixtures produce gameplay contacts without an impulse. The
read-only `detectCollisions` query remains for tests and diagnostics and uses
the same narrow-phase shape algorithms. Neither the internal TOI substeps nor
the separate game movement subdivision was removed.

Added regression checks for two physical impacts in one tick, a radius-0.5
object struck by a thin moving polygon, and unchanged velocity after a fast
nonphysical crossing. Existing checks already cover a tiny fast body against
a thin wall, rotating thin solids, pickup-point and cargo-mouth masks, swept
cargo collection, drill-tip contacts, torque, damage, and deterministic
rollback. `npm run test:collisions` passed. No production source changed, so
the build and initial chunk remain 157,613 raw / 55,880 gzip-level-1 bytes
and production source remains 22,207 lines. Sequential shared-tick benchmark
medians were 2.405, 2.456, and 2.421 ms; predicted tick with capture was
2.669, 2.694, and 2.708 ms. A baseline run of the benchmark with V8
`--trace-gc` reported 562 GC events; this is a coarse allocation proxy for
comparison during the vector/fixture work.

Remaining risks: the Planck translation cap can truncate intended travel,
and browser performance will remain unmeasured by the user's choice. The
translation cap is tracked for final high-speed verification.

## Milestone 3: one vector object (2026-09-24)

Moved the Planck-derived vector class into `src/shared/vector.ts` and removed
`physics-vector.ts`. The game `Vector()` factory and solver now create the
same class. Game methods `add`, `subtract`, `scale`, and `normalize` return new
vectors; solver-only in-place normalization is explicitly
`normalizeSelf()`. `physics-matrix` retains its out-parameter calculations.
No game geometry helper had equivalent semantics to Planck's sweep/transform
operations, so their distinct APIs remain. Required MIT attribution stays with
the moved class and the Kontra-derived game API.

The first implementation regressed shared simulation by about 4% because it
used Planck's `Object.create` vector factory for immutable game arithmetic.
Replacing that path with the optimized constructor removed the regression.
Final sequential shared-tick medians: 2.465, 2.470, 2.443 ms, compared with
the 2.461, 2.455, 2.468 ms baseline. Predicted tick with capture: 2.650,
2.643, 2.666 ms, compared with 2.650, 2.711, 2.729 ms. The coarse V8 GC
count was 564 versus 562 baseline. `build`, `test:collisions`,
`test:simulation`, `test:prediction`, and `lint` passed. The main chunk was
157,381 raw / 55,862 gzip-level-1 bytes, down 232 raw / 18 gzip bytes.
Production TypeScript lines were 22,222, up 15 because vendored one-line
comments were expanded for the project lint rule. The large source and bundle
reduction therefore remains for milestone 5.

Remaining risk: structural callers can still instantiate `Vec2` directly
from the shared class; a method-level reachability pass is needed before
removing unused Planck compatibility methods.

## Milestone 4: friction and material mixing (2026-09-24)

Added object and collider friction, defaulting to 0.01 when unspecified and
retaining an explicit zero. Craft and asteroid surfaces use 0.2; the drill's
physical segment uses 0.3, while its nonphysical tip applies no impulse.
Nested colliders inherit parent friction and bounce unless they set their own
value. Contact friction uses the existing geometric mean through one
`mixFriction` function. Contact restitution now uses one
`mixRestitution` function with `max(0, (a + b) / 2)` and no upper cap; the
low-speed threshold remains. Existing authored bounce values were doubled to
retain their earlier pair responses (hull/asteroid/items 0.2, shield 0.8,
active horn drill -0.4). The inactive drill still inherits hull bounce.
A later cleanup inlined both formulas in the game pre-solve callback and removed
creation-time material copies from fixtures and contacts.

The optional network `friction` field is sent when an object differs from its
class default, including explicit zero. Client decoding resets an omitted
value to the class default; rollback captures friction and prediction copies
authoritative friction. Tests cover wire omission/default restoration, explicit
zero, nested inheritance, negative contribution, bounce above 1, drill
friction and sliding, and rollback. The drill kept damaging a rock for all five
ticks of a tangential slide, moved more than four game units sideways, and
retained inward pull. A zero/0.3/0.6 friction comparison showed five drill
contacts in each case; at 0.3 the ship moved 4.96 game units sideways over
five ticks. The existing break-loose gameplay test expects the drill's
velocity handoff, so its tangential grip was retained pending a separate
gameplay change.

`build`, `test:collisions`, `test:simulation`, `test:prediction`,
`test:server`, and `lint` passed. The first-frame chunk was 157,861 raw /
56,000 gzip-level-1 bytes, 480 raw / 138 gzip bytes larger than after the
vector milestone. Production TypeScript occupied 22,249 lines. Sequential
shared-tick medians were 1.638, 1.654, 1.663 ms; predicted tick with
capture was 1.855, 1.850, 1.862 ms. This benchmark's world trajectory changes
with friction, so the faster timings are evidence of no regression in this
scenario, not a pure instruction-count comparison. Coarse V8 GC count was
518 versus 562 baseline. Browser timings are unavailable by user choice.

Remaining risks: dynamic fixture geometry still rebuilds by serialized shape
comparison; material values update in pre-solve, but fixture metadata on an
unchanged shape remains at its creation value until the next rebuild.

## Milestone 5: reduced and restyled Planck-derived code (2026-09-24)

The method-level reachability audit found no game callers for shape casting,
legacy overlap/distance adapters, generic world events or options, warm
starting, force and damping application, conveyor tangent speed, fixture
filter refresh, stored contact impulses, static debug accessors, and generic
vector/transform constructors and overloads. The game constructs only dynamic
or kinematic bullet bodies with circle or polygon fixtures. The server and
client share this construction path through `GameCollisions`. Those unused
features were removed; the broad phase, circle/polygon manifolds, distance
support, TOI, continuous solver, block solve, and internal TOI substeps remain.
The optional Planck `subStepping` switch was removed because it was always
false; the game's separate movement subdivision remains. Required upstream
license notices remain on adapted files.

`World` now exposes only the game's pre-solve callback. Body and fixture
constructors accept the game's actual definitions; vector, rotation, and
transform code has explicit operations rather than Planck's deprecated or
polymorphic helpers. The read-only overlap query and gameplay fixture path
share one solver shape builder. Stored manifold impulses and warm-start work
were unreachable because every world step set `warmStarting = false`.
Forces, gravity, damping, sleeping, and conveyor behavior had no game callers
or nonzero configured values. Contact filter changes already rebuild fixtures
through the geometry key, so the never-called filter-refresh flag was removed.

A 300-tick profile after warm-up saw 43 entities and 12,900 `sync` calls;
`sync` took 441.55 ms (about 29% of 1.52 s of unbundled tick work), with
zero fixture rebuilds. Fixture signature caching was retained. A new regression
case grows and shrinks an outline across a contact to prove that fixture and
broad-phase rebuilding still occurs when geometry changes. Cases at 190, 210,
and 400 game units of requested travel cross a thin face within the current
200-unit per-step translation cap without phasing. A 400-unit nonphysical
crossing reports a trigger event and matches the capped motion of a body
without that trigger. Multiple physical impacts, tiny fast bodies, and moving
thin obstacles remain covered.

`build`, `test:collisions`, `test:simulation`, `test:prediction`,
`test:server`, and `lint` passed. The first-frame chunk is 142,436 raw /
51,391 gzip-level-1 bytes, down 15,177 raw (9.6%) / 4,489 gzip (8.0%)
from the fresh baseline. Production TypeScript is 20,051 lines, down 2,156
(9.7%). Sequential shared-tick medians were 1.714, 1.688, and 1.631 ms;
these varied with machine load, while the preceding three runs were 1.623,
1.632, and 1.628 ms. All are below the fresh 2.45–2.47 ms baseline. Predicted
tick with capture measured 1.982, 1.856, and 1.827 ms. The coarse GC count
was 510, compared with 562 initially. No browser measurements were run by
user choice.

Remaining risk: the translation cap limits actual movement in one solver
step. It prevents tunnelling through an obstacle reached within the cap, but
cannot promise a contact with an obstacle beyond the distance traveled in that
step. The game's separate movement subdivision and distant catch-up behavior
will be checked in final verification.

## Milestone 6: repository-wide duplicate audit and terminology

Before editing this milestone, a scan of every `src` file and exported utility
identified these remaining overlaps and distinctions:

| Implementations                                                                                                                | Callers, behavior, and sensitivity                                                                                                                                                                                                   | Size impact and owner                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual forward rotation in asteroid splitting and asteroid presentation versus `rotatePoint`                                   | Splitting runs when a rock breaks; presentation positions buried items each render frame. Both calculate the same local-to-world rotation as `rotatePoint`.                                                                          | Shared `rotatePoint` owns this transform; allocation and trig counts remain the same per use. Small first-chunk reduction.                     |
| Manual forward and inverse rotation inside `asteroidContact` versus `rotatePoint`                                              | One contact query uses the same sine/cosine pair for both directions.                                                                                                                                                                | Keep the paired arithmetic to avoid a second pair of trig calls in a simulation path.                                                          |
| Manual sine/cosine in cargo door geometry, polygon generation, shield effects, and lighting versus `directionOf`/`rotatePoint` | These produce multiple related points, arrays, or shading values from each sine/cosine pair.                                                                                                                                         | Keep the distinct calculations; wrapping each point would add allocations and trig calls.                                                      |
| `client/road.ts` and `client/particles.ts` versus active movement and shrapnel sparks                                          | Only a commented import reaches the road; only the road imports particle stubs. Both are absent from the production chunks and have no tests. Road movement and particle sparks duplicate active behavior only in an unused feature. | Delete these unused source files and the commented import; source-line reduction, no chunk effect. Active movement and shrapnel remain owners. |
| `sound-loader`/`sound` and `docked-loader`/`docked`                                                                            | Lightweight loaders defer sound and docked UI implementations to separate chunks.                                                                                                                                                    | Preserve the loading boundary; not duplicate behavior.                                                                                         |
| Procedural and server `RegionManager`                                                                                          | The shared manager generates/query descriptions; the server manager materializes and sleeps simulation entities.                                                                                                                     | Preserve the separate owners.                                                                                                                  |
| `detectCollisions`/`contactBetween` versus `GameCollisions`                                                                    | Only tests and prediction diagnostics import the read-only pair traversal. It shares narrow-phase and solver shape creation with gameplay but has different read-only depth and mutation semantics.                                  | Preserve the diagnostic query; it is absent from production chunks. `GameCollisions` remains gameplay owner.                                   |
| Shared movement subdivision, Planck TOI substeps, client partial-tick prediction, and render interpolation                     | Each has a different time or state contract. Server and client prediction already use the same shared simulation.                                                                                                                    | Preserve the separate mechanisms.                                                                                                              |

The completed milestone consolidated the equivalent forward rotations used by
asteroid splitting, buried-item presentation, and server spawn placement into
`rotatePoint`/`directionOf`. Their old call sites allocated one vector and
calculated one sine/cosine pair, as the shared helpers now do. The paired
forward/inverse asteroid contact math stayed local to reuse one sine/cosine
pair. `client/road.ts` and its spark stubs in `client/particles.ts` had no
active import or test caller, so they and the commented import were deleted.
The other entries above have distinct contracts or preserve lazy chunk loading.

`docs/terminology.md` now defines vector, collision detection, physical
response, sweep, continuous collision detection, time of impact, physics
substep, friction, and bounciness. Its definition of tunnelling says an object
can “phase through” another when the crossing is missed.

`build`, `test:collisions`, `test:simulation`, `test:shared`, `test:server`, and
`lint` passed. The first-frame chunk is 142,311 raw / 51,341 gzip-level-1
bytes. Production TypeScript is 19,849 lines, down 2,358 (10.6%) from the
fresh baseline. Three sequential shared-tick medians were 1.496, 1.476, and
1.484 ms; predicted tick with capture was 1.708, 1.723, and 1.684 ms. The
coarse V8 GC count was 508. This benchmark change is likely influenced by
machine clock/load because removed road code was not bundled and the rotation
sites are not in the steady shared tick. Final verification must repeat the
measurement. The remaining risk is the known translation cap behavior.

## Milestone 7: final verification (2026-09-24)

The final full `npm test` run passed, including typecheck, formatting rules,
shared objects and rendering, simulation and snapshots, regions, server,
prediction, collisions, docked UI, prism, sound, and input. `npm run lint`,
`npm run build`, and `git diff --check` also passed. The collision tests cover
physical and nonphysical fast crossings, multiple impacts in a tick, a tiny
body and moving thin obstacle, changing fixture geometry, filtering, bounce,
friction, cargo pickup and the horn-drill trigger. The simulation suite checks
30 Hz tick scheduling with 60 Hz visible movement and 15 Hz distant updates,
distant-to-visible catch-up, rollback of scheduler phase, drill sliding, and
asteroid splitting. Prediction and server integration tests check the shared
physics path, snapshots, two-client contacts, and network compatibility.

| Measure                                     | Fresh baseline |   Final |          Change |
| ------------------------------------------- | -------------: | ------: | --------------: |
| Main JS chunk, raw bytes                    |        157,613 | 142,250 | -15,363 (-9.7%) |
| Main JS chunk, gzip-level-1 bytes           |         55,880 |  51,346 |  -4,534 (-8.1%) |
| Production TypeScript lines in `src`        |         22,207 |  19,726 | -2,481 (-11.2%) |
| Coarse V8 GC events during shared benchmark |            562 |     509 |             -53 |

Three final sequential shared simulation tick medians were 1.495, 1.486, and
1.485 ms (fresh baseline: 2.461, 2.455, and 2.468 ms). Predicted tick with
capture was 1.655, 1.694, and 1.705 ms (baseline: 2.650, 2.711, and 2.729
ms). Rollback capture was 0.167, 0.172, and 0.174 ms (baseline: 0.188,
0.187, and 0.187 ms). The friction change alters benchmark trajectories and
CPU clock/load varied between runs, so these are scenario measurements rather
than pure instruction-count comparisons. None shows a sustained regression.

The required browser benchmark was omitted because this machine has no
Chrome/Chromium binary and the user chose shared benchmarks only. The solver's
200-game-unit translation cap remains: a requested displacement beyond it is
truncated in a single physics step. Tests show contacts with thin physical
faces and nonphysical triggers within the traveled portion of 210- and
400-unit requested sweeps, without phasing or trigger impulses. An obstacle
beyond the traveled portion cannot be contacted until a later step. This is
a documented movement limit rather than a missed crossing.

## Follow-up: remaining Planck scaffolding audit (2026-09-24)

Fresh same-build baseline for this follow-up: main chunk 142,250 raw bytes and
51,346 gzip-level-1 bytes; 19,726 production TypeScript lines. Three sequential
shared-tick medians: 1.476, 1.470, 1.478 ms; predicted-with-capture: 1.657,
1.678, 1.679 ms; rollback capture: 0.164, 0.171, 0.171 ms. The user chose
shared benchmarks only because Chrome/Chromium is unavailable.

| Duplicate or dead pattern                                                             | Callers/reachability and behavior                                       | Performance and bundle effect                                              | Owner/decision                                                                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `_ASSERT = false` and guarded `console.assert` across vendored collision and dynamics | No guarded assertion executes; no gameplay caller depends on it         | Dead code is minified away but clutters source; no expected runtime change | Remove guards and declarations; tests own invariants                                                    |
| `DEBUG_SOLVER = false` and postcondition calculations in contact solver               | Never reached; normal block solver still runs                           | Dead in output, sizeable source block                                      | Remove postconditions only; keep the four solver cases                                                  |
| `Vec2.assert`, `AABB.assert`, `AABB.isValid` and instance `isValid`                   | No live callers; AABB validation is reached only by disabled assertions | Potentially tree-shaken, no solver need                                    | Remove; keep live `Vec2.isValid`                                                                        |
| Sleep tolerances in `Settings` and `SettingsInternal`                                 | No references outside their own getters since sleep was removed         | Dead settings API and source                                               | Remove both declarations and forwarding getters                                                         |
| `math_*` aliases for built-in `Math` functions/constants                              | Used in vector, geometry, TOI, collision and solver code                | Calls may be hot; measure repeated shared ticks and chunk                  | Use `Math.*` directly where equivalent                                                                  |
| `@internal` / `@hidden` JSDoc tags                                                    | Type/documentation labels only; many prefix live declarations           | No runtime/bundle effect                                                   | Remove tags while preserving declarations and useful comments                                           |
| Index and `while` loops in tree, GJK/TOI, manifold solver, linked lists               | Required for indexed paired arrays, mutation, worklists or early exits  | Callback allocation can affect hot solver; order matters                   | Keep algorithmic loops; convert straightforward collection construction/traversal where semantics match |

### Follow-up milestone A: dead assertions and validation (verified)

Removed all false-guarded Planck assertions and solver debug postconditions,
unused AABB/Vec2 assert helpers, and sleep settings with no callers. This
preserves normal solver branches and live vector validation. Collision,
simulation, prediction, typecheck and production build passed. Main chunk is
141,481 raw and 51,174 gzip-level-1 bytes, down 769 and 172 from the follow-up
baseline; production TypeScript is 19,518 lines, down 208. Three shared-tick
medians: 1.466, 1.488, 1.488 ms; predicted-with-capture: 1.714, 1.689,
1.687 ms. Rollback capture: 0.194, 0.169, 0.166 ms. First rollback run appears
to be a transient outlier. Remaining risks: direct `Math` calls and any loop
rewrites still need separate measurement.

### Follow-up milestone B: built-ins and documentation tags (verified)

Replaced all vendored `math_*` aliases with direct `Math` calls/constants and
removed `@internal`/`@hidden` tags. Kept comments that explain behavior and
all Planck license notices. Removed an inactive TOI debug sketch and references
made unused by the assertion cleanup. Collision and simulation tests,
typecheck, lint, production build, and `git diff --check` passed. Main chunk:
141,523 raw and 51,047 gzip-level-1 bytes; production TypeScript: 19,409
lines. Shared-tick medians: 1.462, 1.491, 1.457 ms; predicted-with-capture:
1.672, 1.682, 1.677 ms; rollback: 0.172, 0.168, 0.167 ms. There is no
sustained shared benchmark regression against the immediately prior milestone.
The remaining risk is distinguishing collection loops from solver/worklist
loops without changing traversal semantics or hot-path cost.

Additional reachability finding before milestone C: the vendored `Pool` has only
three callers (contacts, dynamic-tree nodes and query stacks). Every caller
supplies `create` and `release`; none supplies `max`, `allocate` or `dispose`,
or calls `max()`, `size()` or `toString()`. Keep the pool as owner of the three
reuse paths, preserving its FIFO reuse order; remove the unreachable generic
features. Polygon hull copying and normal construction are bounded array
transformations with no early exit, so `map` can express them. Tree traversal,
GJK/TOI iteration, proxy synchronization and the manifold solver retain their
indexed/worklist loops because they use indices, mutation or early exits and
are performance-sensitive.

### Follow-up milestone C: reachable pool and collection mapping (verified)

Reduced the Planck pool to the creation, recycle callback, and FIFO reuse used
by its three callers. Its optional capacity, allocation/disposal callbacks,
statistics and reporting had no callers. Replaced polygon hull vertex copying
and normal construction loops with `map`; kept all algorithmic, linked-list and
hot proxy loops. Typecheck, lint, collision and simulation tests, production
build, and three shared benchmarks passed. Main chunk: 140,448 raw and 50,718
gzip-level-1 bytes; production TypeScript: 19,304 lines. Shared-tick medians:
1.482, 1.482, 1.495 ms; predicted-with-capture: 1.690, 1.687, 1.712 ms;
rollback: 0.165, 0.169, 0.181 ms. These overlap the fresh baseline and show
no sustained slowdown. Remaining risks: commented-out legacy code needs a
final sweep, and the full test suite and formatting check remain.

### Follow-up milestone D: legacy comments and final verification

Removed commented-out Planck statements, stale references to removed APIs and
an inaccurate BlockAllocator comment. The full `npm test` suite, typecheck,
`npm run lint`, `npm run format:check`, production build and `git diff --check`
passed. A later comment-only edit was rechecked with typecheck, lint, formatting
and diff validation. The final main chunk is 140,448 raw and 50,718
gzip-level-1 bytes, down 1,802 raw (1.3%) and 628 gzip (1.2%) from the fresh
follow-up baseline. Production TypeScript is 19,188 lines, down 538 (2.7%).
No `console.assert`, `_ASSERT`, `DEBUG_SOLVER`, `@internal`, `@hidden` or
`math_*` built-in aliases remain in production `src`.

Final three shared-tick medians measured 1.625, 1.627 and 1.613 ms; the next
three were 1.625, 1.623 and 1.622 ms. The machine was measurably slower than
at the fresh baseline (1.476, 1.470, 1.478 ms). To distinguish a code change
from machine load, same-session A/B measurements compared the current code
against isolated alternatives. Direct `Math` calls measured 1.633 and 1.634
ms versus aliases at 1.645 and 1.617 ms. Polygon `map` measured 1.640 and
1.652 ms versus the former indexed loops at 1.633 and 1.634 ms. Restoring the
old pool temporarily measured 1.623, 1.694 and 1.596 ms, overlapping the new
pool's 1.62 ms range. These comparisons show no material sustained regression
from the cleanup; the small polygon difference is within the run-to-run spread.
The benchmark uses shared simulation only, per the user's earlier choice.

## Follow-up: shared distance and scalar geometry audit (2026-09-24)

Fresh same-machine/build baseline before this follow-up: main chunk 140,448 raw /
50,718 gzip-level-1 bytes; production TypeScript 19,188 lines. Three sequential
shared-tick medians were 1.628, 1.613 and 1.601 ms; predicted-with-capture
medians were 1.852, 1.850 and 1.843 ms. Browser measurement remains omitted
by the user's choice.

| Candidate                                                                                                  | Callers, behavior, and sensitivity                                                                                                                                      | Decision                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `physics-matrix.dotVec2` (63 calls) and `crossVec2Vec2` (39) versus `Vec2.dot` and `Vec2.crossVec2Vec2`    | Formulas are identical; used throughout hot manifold, TOI and solver work. `Vector` is already in the initial chunk.                                                    | Use the shared Vector static methods; benchmark for call overhead.                                                   |
| `physics-matrix.lengthSqrVec2` (5) and `distSqrVec2` (3) versus `Vec2.lengthSquared` and `distanceSquared` | Same arithmetic and return type; callers include polygon contacts, GJK and translation limiting.                                                                        | Use Vector static methods.                                                                                           |
| `physics-matrix.distVec2` (2) versus `Vec2.distanceSquared` / `distanceTo`                                 | GJK needs `sqrt(dx² + dy²)` while game `distanceTo` uses `hypot`, which has stronger overflow behavior and can round differently.                                       | Compute `Math.sqrt(Vec2.distanceSquared(...))` for GJK, preserving its arithmetic; keep game `distanceTo` unchanged. |
| `physics-matrix` out-parameter vector arithmetic versus Vector object methods                              | Solver and contact code writes into scratch objects, while game arithmetic creates vectors.                                                                             | Keep out-parameter operations and plain scratch objects; allocations are performance-sensitive.                      |
| GJK `Distance` versus game object distance and read-only contact query                                     | GJK computes closest points between moving convex shapes for TOI; game `distanceTo` measures points; `contactBetween` queries manifolds.                                | Keep distinct algorithms; only share their exact scalar primitives.                                                  |
| `normalizeVec2`/`normalizeVec2Length` versus `normalizeSelf`                                               | Return values and zero thresholds differ; TOI uses the returned length.                                                                                                 | Preserve these semantics until a separate measured change can prove equivalence.                                     |
| `shapeOf` versus craft wreckage midpoint/reach calculation                                                 | Both derive midpoint and maximum point distance; the craft also handles absent and empty outlines differently. This runs on creation/detachment, not the steady solver. | Evaluate a shared outline extent calculation after scalar math verification.                                         |

### Scalar consolidation trial: static Vector methods (not retained)

An initial migration removed the five duplicate `physics-matrix` scalar
helpers and called existing `Vec2` static methods. Collision and simulation
tests, typecheck, lint and build passed, but the main chunk grew from 140,448 /
50,718 to 141,150 / 50,758 raw/gzip bytes, and three shared-tick medians
rose from 1.628/1.613/1.601 to 1.643/1.679/1.664 ms. The static property
calls are a likely source of extra output and dispatch cost. The next trial
will use named functions owned by `vector.ts`, then verify separately.

### Shared scalar math milestone: solver utility owns exact formulas (verified)

Retained the five already optimized scalar functions in `physics-matrix` as the
single implementations of dot product, 2D cross product, squared length,
squared distance and Euclidean distance. Removed their duplicate `Vec2` static
methods; the game Vector's instance `dot` and `lengthSquared` delegate to the
same functions. Removed unused `Vec2.lengthOf`. GJK keeps its original
`sqrt(dx² + dy²)` calculation through the shared solver function; game
`distanceTo` keeps `Math.hypot` for its existing rounding and overflow behavior.
Out-parameter solver operations and the GJK closest-shape algorithm remain
separate because their behavior is different.

Typecheck, lint, collision and simulation tests, and production build passed.
The main chunk is 140,080 raw / 50,664 gzip-level-1 bytes, down 368 / 54
from this follow-up baseline. Production TypeScript is 19,174 lines, down 14.
Sequential shared-tick medians were 1.650, 1.644 and 1.648 ms. Same-session
alternating A/B runs against the pre-edit source measured 1.627 and 1.615 ms
for the baseline and 1.635 and 1.619 ms for this version; predicted tick was
1.839/1.848 versus 1.846/1.816 ms. These overlap, with no sustained
performance regression attributable to this change. The earlier Vector-static
and Vector-function trials were rejected because they grew the chunk or showed
a repeatable slowdown. Remaining risk: outline extent arithmetic is still
duplicated between shading and wreckage construction.

### Outline extent inventory before editing

`shapeOf` runs for nonempty fixed craft segment outlines and computes midpoint,
facing and maximum point distance from that midpoint. `Craft.detach` repeats
midpoint and maximum distance for wreckage, with separate results for a missing
outline (radius 0) and an empty outline (radius `-Infinity`). `radiusOf` in
`polygon.ts` computes the same maximum distance from the origin for asteroid
children and items. These are creation/detachment paths, outside the steady
physics solver. Proposed owner: `radiusOf(points, center)` for the farthest
point and `outlineExtent(points)` for midpoint plus radius. Keep the current
empty/missing behavior and test the existing wreckage cases.

### Outline extent milestone (verified)

Added `outlineExtent` for the shared midpoint and farthest-point radius used by
segment shading and wreckage. `radiusOf` now also accepts a center point, so
origin and midpoint radii use the same distance calculation. The missing and
empty wreckage outline results remain 0 and `-Infinity`, respectively.
Typecheck, lint, shared object/rendering, collision and simulation tests, and
build passed. The main chunk is 140,040 raw / 50,698 gzip-level-1 bytes;
production TypeScript is 19,175 lines. Against the scalar-math milestone, raw
size fell by 40 bytes while gzip rose by 34 bytes; against this follow-up's
fresh baseline, both remain smaller. Three shared-tick medians were 1.672,
1.647 and 1.637 ms. The creation/detachment calculation does not run in the
steady shared tick; current machine load remains variable. Remaining risk:
one allocating transform wrapper in TOI has a direct out-parameter equivalent.

### Transform wrapper reachability before editing

`Transform.mulVec2` has one caller in TOI separation initialization, where it
allocates a new vector and shadows an already available `pointA` scratch vector.
`physics-matrix.transformVec2` performs the same multiply into a supplied
vector and is already used in the adjacent TOI branches. Replace the call
with the scratch operation and remove the wrapper. Preserve the `Transform`
class, which still owns collider pose state in bodies, distance input and
read-only contacts. This is a TOI hot path, so benchmark after collision tests.

### TOI transform wrapper milestone (verified)

Replaced the sole `Transform.mulVec2` call in TOI with the equivalent
`matrix.transformVec2` write into an existing scratch vector, then removed the
allocating wrapper. Typecheck, lint, collision and simulation tests, build and
three shared benchmarks passed. Main chunk: 139,947 raw / 50,653
gzip-level-1 bytes; production TypeScript: 19,170 lines. Shared-tick medians:
1.639, 1.652 and 1.650 ms, overlapping the immediately prior milestone.
No contact behavior or continuous-collision branch changed.

### GJK distance options before editing

`Distance` has one caller, `TimeOfImpact`. That caller always sets
`DistanceInput.useRadii = false`; no test or production source sets it true.
The optional radius-adjustment branch, its scratch normal and the flag cannot
be reached. `DistanceOutput.iterations`, `DistanceInput.recycle` and
`DistanceOutput.recycle` have no callers. Keep the proxy radii themselves:
TOI uses them to establish its target separation and the shape proxy methods
still populate them. Keep witness points, GJK iteration and simplex cache,
which calculate the distance used by the TOI loop. Remove only the unreachable
options and reporting, then run tiny-fast-body and moving-obstacle coverage.

### GJK optional-radius milestone (verified)

Removed the never-enabled radius adjustment from GJK distance, its scratch
normal, the unused distance-output iteration report and unreachable input/output
recycle methods. TOI still reads proxy radii for target separation and still
uses GJK witness points for the closest-point distance. Typecheck, lint,
collision and simulation tests, build, and three shared benchmarks passed.
Main chunk: 139,437 raw / 50,438 gzip-level-1 bytes; production TypeScript:
19,126 lines. Shared-tick medians were 1.654, 1.605 and 1.627 ms, overlapping
the fresh baseline and prior milestone.

### GJK input-copy inventory before editing

`DistanceInput` is used only by `TimeOfImpact`. TOI copies both proxy vertex
arrays/radii once per call and both transforms before every GJK query. GJK
reads these inputs synchronously and never mutates them; the TOI proxies and
transform scratch values remain valid for the entire query. Point
`DistanceInput` at those same objects, then remove the two duplicate proxy
objects, two duplicate transform objects and the now-unused `copyTransform`
helper. The input remains a single reusable object, with no per-query
allocation. Verify high-speed collisions and shared performance afterward.

### GJK input-copy milestone (verified)

`DistanceInput` now references the TOI proxies and transform scratch objects for
each synchronous GJK query. Removed the duplicate proxy/transform instances,
the per-query copies, and `copyTransform`, whose only callers were those copies.
Typecheck, lint, collision and simulation tests, and production build passed.
Main chunk: 139,250 raw / 50,358 gzip-level-1 bytes; production TypeScript:
19,108 lines. Shared-tick medians were 1.661, 1.652 and 1.635 ms;
predicted-with-capture medians were 1.860, 1.864 and 1.843 ms. Those overlap
prior measurements. The remaining transform scratch is shared within the
existing non-reentrant TOI code, so passing a reference adds no new
concurrency assumption.

### Distance follow-up: final verification

The full `npm test` suite passed, including shared simulation, snapshots,
server/prediction compatibility, collision and gameplay tests, plus the lazy
production-chunk checks. `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run build` and `git diff --check` passed. The
final main chunk is 139,250 raw / 50,358 gzip-level-1 bytes versus the fresh
follow-up baseline of 140,448 / 50,718, a reduction of 1,198 raw and 360
gzip bytes. Production TypeScript is 19,093 lines versus 19,188, down 95.
The earlier project baseline was 157,613 raw / 55,880 gzip bytes and 22,207
production lines. All required license notices remain.

The final alternating same-machine shared benchmark used isolated copies of
the pre-edit and final source in baseline/final/final/baseline/baseline/final
order. Shared-tick medians were 1.614, 1.636 and 1.656 ms for baseline and
1.632, 1.644 and 1.638 ms for final. Predicted-with-capture medians were
1.867, 1.860 and 1.847 ms for baseline and 1.891, 1.855 and 1.860 ms for
final. These ranges overlap and do not show a sustained regression. Browser
measurements remain omitted by the user's earlier choice. GJK closest-shape
distance, ordinary point distance, and normalization with different zero
thresholds remain separate because their behavior is meaningfully different.

### Residual Planck cleanup inventory and fresh baseline

Fresh build on this checkout: main chunk 139,250 raw / 50,358 gzip-level-1
bytes; production TypeScript 19,093 lines. Three shared-tick medians were
1.646, 1.627 and 1.642 ms; predicted-with-capture 1.853, 1.880 and
1.873 ms. Browser measurements remain outside scope by user choice.

The shape type union lists `edge` and `chain`, but only circle and polygon
classes and contact registrations exist. Narrow the union; contact dispatch
remains its owner. The three collision evaluation callbacks receive child
indices that none reads; contact identity, broadphase and TOI still need the
stored indices. Remove only callback arguments. Planck TODO comments are
stale notes, except the `DistanceProxy.set` note points to a live one-line
wrapper; replace that call with shape-owned proxy setup. The `@deprecated`
tags on `mod` and `clamp` misdescribe live functions used by sweep and contact
solver, respectively. Preserve behavior and remove tags.

`body-velocity.ts` holds one two-field class used only by `Body`.
`body-position.ts` holds a similar class used only by `Body` and a transform
helper used only by contact solving. Move each to its owning file, preserving
the Planck license notices. These objects are allocated per body, while the
transform helper runs during solving; keep its out-parameter behavior.

`Settings.lengthUnitsPerMeter` is fixed at 1 and only multiplies settings
getters. Angular slop and max angular correction have no runtime readers.
Remove those entries and identity products. Keep the remaining solver and
broadphase constants, including the runtime-set low-speed bounce threshold.
`maxPolygonVertices` currently truncates input at 12 and separately caps TOI
push-back iterations. Remove the input truncation and replace the TOI cap with
a finite per-pair bound based on actual proxy vertex counts. Gift wrapping,
GJK distance and TOI are sensitive to vertex counts, so verify 20/30 point
shapes, fast contacts and shared tick performance before accepting this change.

The `Settings`/`SettingsInternal` split forwards many live settings. It is
duplicative but changing its public mutability would affect the game physics
threshold configuration; defer that larger interface change. Solver loops
remain loops where they mutate scratch vectors or stop early, avoiding new
allocation in hot paths.

### Residual API milestone (verified)

Narrowed shape dispatch types to circle/polygon, removed unused child-index
parameters from collision evaluator callbacks while retaining contact identity
indices, and replaced the live distance-proxy forwarding method with the
shape-owned operation. Removed stale Planck TODO and deprecation annotations;
`mod` and `clamp` remain live. Typecheck, collision tests and production build
passed. Main chunk: 139,204 raw / 50,321 gzip-level-1 bytes; production
TypeScript: 19,059 lines. Three shared-tick medians: 1.633, 1.659 and
1.651 ms; predicted-with-capture: 1.875, 1.876 and 1.871 ms. These overlap
the fresh baseline. The first attempted benchmark capture used a wrong output
filter; the recorded runs above are unfiltered successful executions.
Remaining work: tiny state files, settings and polygon limit.

### Body state ownership milestone (verified)

Moved the two-field velocity/position state classes into their only owner,
`Body`, and the out-parameter contact transform into its only caller file.
Deleted `body-velocity.ts` and `body-position.ts`, including the unused
`Position.getTransform` duplicate. The adapted code retains its Planck MIT
attribution. Collision tests, typecheck and production build passed. Main
chunk: 139,052 raw / 50,275 gzip-level-1 bytes; production TypeScript:
19,013 lines. Three shared-tick medians: 1.627, 1.643 and 1.615 ms;
predicted-with-capture: 1.834, 1.855 and 1.837 ms. No sustained regression
relative to the fresh baseline. Remaining work: settings and polygon limit.

### Settings ownership milestone (verified)

Removed the unused angular tolerances and fixed one-unit scale, then merged
`SettingsInternal` into `Settings` so live callers use one owner. Kept the
runtime-set velocity threshold and all live CCD, solver, broadphase and
correction limits. Typecheck, collision tests and production build passed.
Main chunk: 137,777 raw / 50,043 gzip-level-1 bytes; production TypeScript:
18,931 lines. Three shared-tick medians: 1.628, 1.638 and 1.643 ms;
predicted-with-capture: 1.849, 1.863 and 1.864 ms, overlapping the fresh
baseline. Remaining risk: removing polygon truncation changes how 13+ point
inputs are represented; verify that separately.

### Polygon vertex milestone (verified)

Removed the 12-vertex construction cap, which previously discarded later
input points. TOI retains a finite push-back bound of at least the former 12
iterations and now permits one iteration per vertex on either shape. Added
20- and 30-point convex-hull tests with fast swept physical contacts; existing
tiny-body, moving-wall, repeated-impact and trigger tests also passed.
Typecheck and production build passed. Main chunk: 137,733 raw / 50,034
gzip-level-1 bytes; production TypeScript: 18,927 lines. Shared-tick medians:
1.640, 1.623 and 1.641 ms; predicted-with-capture: 1.865, 1.823 and
1.861 ms. The ranges overlap the fresh baseline. The current shared benchmark
contains ordinary shapes; pathological huge polygons remain more expensive to
hull and collide, as expected from their vertex count.

### Residual cleanup final verification

Full `npm test` passed, covering shared simulation, snapshots, regions, server,
prediction, collisions, docked loading, input and gameplay. `npm run lint`,
`npm run format:check`, final `npm run build`, and `git diff --check` passed.
No `TODO`, `@internal`, `@hidden`, `@deprecated`, `console.assert`, `_ASSERT`,
`math_max`, `SettingsInternal` or `maxPolygonVertices` remains in `src`.
Final main chunk is 137,733 raw / 50,034 gzip-level-1 bytes versus this
follow-up's fresh baseline of 139,250 / 50,358, down 1,517 raw and 324 gzip
bytes. Production TypeScript is 18,915 lines versus 19,093, down 178. Against
the project's earlier baseline of 157,613 raw / 55,880 gzip bytes and 22,207
production lines, this is down 19,880 raw bytes, 5,846 gzip bytes and 3,292
lines. Repeated shared benchmarks after each functional milestone overlapped
the fresh baseline; no sustained shared-tick slowdown was observed. Browser
benchmarks were omitted by the user's explicit choice.

The remaining `physics-matrix` squared-distance routine computes a scalar
without allocating a Vector and is called by hot collision paths. The game
Vector's `distanceTo` returns a regular distance using `Math.hypot`; replacing
squared comparisons with it would add a square root and change their
threshold arithmetic. GJK's shape distance remains separate because it
computes witness points and closest convex features, not point distance.

### Additional dead API inventory and fresh baseline

This pass starts from a fresh build of 137,733 raw / 50,034 gzip-level-1
bytes in the main chunk and 18,915 production TypeScript lines. Three
shared-tick medians were 1.637, 1.636 and 1.629 ms; predicted-with-capture
medians were 1.889, 1.860 and 1.847 ms. Browser benchmarks remain omitted
by user choice.

Repository-wide caller searches found no use of `PointState`,
`getPointStates`, or the four static aliases on `Manifold`. Polygon clipping
uses the separately exported `ClipVertex` class and `clipSegmentToLine`
function; the contact solver uses manifold points directly. Remove only the
dead point-state reporting and aliases. `BroadPhase.getFatAABB` has no caller;
its live tree-owned counterpart remains used by broadphase overlap/query.
`AABB.areEqual` has no caller, and its sole dependency `Vec2.areEqual` also
has no other caller. The AABB instance `extend` wrapper has no caller while
`AABB.extend` is used by the dynamic tree. Every AABB allocation passes no
constructor arguments; every `combine` call supplies two boxes. Remove those
unused options, leaving the live out-parameter operations with AABB.

`Transform.setIdentity` and `Transform.setTransform` have no callers; their
sole `Rot.setIdentity` and `Rot.setRot` dependencies become dead with them.
Retain `Transform.identity`, `Transform.setNum`, `Rot.identity`, and
`Rot.setAngle`, which construct and update collider poses. These dead APIs
are unreachable on client, server, and shared code paths, including tests.
The changes have no per-tick algorithm or contact result branch to replace.

### Additional dead API milestone (verified)

Removed unreachable manifold point-state reporting and static aliases,
BroadPhase's unused fat-AABB forwarding method, AABB's unused constructor
options, optional one-box combine path, instance extend wrapper and equality
helper, the equality helper's now-dead Vector dependency, and unused
Transform/Rot reset and copy methods. Kept live clipping, tree AABB access,
pose updates and contact state. Collision tests, typecheck and production
build passed. Main chunk: 136,620 raw / 49,662 gzip-level-1 bytes;
production TypeScript: 18,803 lines. Three shared-tick medians were 1.625,
1.630 and 1.605 ms; predicted-with-capture 1.852, 1.856 and 1.823 ms.
These overlap the fresh baseline and show no sustained slowdown.

### TOI reset inventory before editing

The solver creates one reusable `TOIInput` and `TOIOutput` at module load and
sets proxy geometry, sweeps, maximum time and output state before each TOI
query. Neither object's `recycle` method has a caller. `TOIInput.recycle` is
the only caller of `DistanceProxy.recycle` and `Sweep.recycle`, making those
resets unreachable too. `DistanceProxy.setVertices` has no caller; the live
circle/polygon `computeDistanceProxy` methods populate its vertices, count and
radius directly. Remove this dead reset/alternate-setup chain. Keep the live
`SimplexCache.recycle`, `Simplex.recycle` and separation-function reset used
within each TOI query. This removes API surface without changing hot query
steps or allocations.

### TOI reset milestone (verified)

Removed never-called `TOIInput.recycle`, `TOIOutput.recycle`,
`DistanceProxy.recycle`, `Sweep.recycle` and `DistanceProxy.setVertices`.
Circle and polygon shape methods remain the only proxy geometry writers;
within-query simplex and separation resets remain intact. Collision tests,
typecheck and production build passed. Main chunk: 136,255 raw / 49,579
gzip-level-1 bytes; production TypeScript: 18,768 lines. Three shared-tick
medians: 1.650, 1.648 and 1.625 ms; predicted-with-capture: 1.843, 1.855
and 1.865 ms. These overlap the fresh baseline.

### Angle-wrap inventory before editing

`physics-math.mod` is called once, by `Sweep.normalize`, always with
`(-Math.PI, +Math.PI)`. Its default-argument and reversed-range branches
cannot be reached. `Sweep.normalize` must preserve the exact modulo result,
including mapping positive `+PI` to `-PI` and adjusting both sweep angles by
the same amount for TOI. Inline that one case and remove the generic Planck
helper. Keep `clamp` because the contact solver uses it for position and
friction impulses; keep `EPSILON` for GJK and contact tolerances. This changes
one setup calculation per TOI query, so verify fast and rotating contacts and
shared performance before accepting it.

### Angle-wrap milestone (verified)

Replaced the sole `mod` call in `Sweep.normalize` with its exact fixed-range
formula and removed the unreachable generic argument/range branches. Positive
PI still wraps to negative PI, and the sweep's relative angular displacement
is unchanged. A boundary/sample equivalence check, collision tests, typecheck
and production build passed. Main chunk: 136,152 raw / 49,566 gzip-level-1
bytes; production TypeScript: 18,750 lines. Three shared-tick medians: 1.643,
1.656 and 1.605 ms; predicted-with-capture: 1.863, 1.871 and 1.846 ms.
These overlap the fresh baseline.

### Constant body-flag inventory before editing

`Body.m_activeFlag` is initialized true and never assigned again anywhere in
the repository. Its only readers are `Body.isActive`, the solver seed test,
and conditionals around fixture proxy creation/destruction. All current
fixtures therefore always create and destroy proxies; remove the inactive
branch and method. `Body.m_fixedRotationFlag` is initialized false and never
assigned again. Its only readers guard positive-inertia calculations in
`resetMassData` and `setMassData`; remove the false condition while preserving
the existing positive-inertia checks and results. These fields are internal
to the Planck-derived `Body`; game code creates bodies only through
`GameCollisions`. Keep the independently mutable awake/island/contact flags.
`m_bulletFlag` is also always true, but its branches choose CCD treatment;
audit and verify it separately before changing any of them.

### Constant body-flag milestone (verified)

Removed always-true active state and always-false fixed-rotation state from
`Body`. Fixture proxies still always enter and leave broadphase, and positive
inertia is still calculated by the same formulas. Collision tests, typecheck
and production build passed. Main chunk: 135,891 raw / 49,518 gzip-level-1
bytes; production TypeScript: 18,734 lines. Three shared-tick medians: 1.674,
1.608 and 1.660 ms; predicted-with-capture: 1.882, 1.849 and 1.876 ms.
Run-to-run variation overlaps the fresh baseline; no sustained slowdown is
evident. The always-true bullet flag and static-body branches remain pending
separate scope and CCD review.

### Always-on CCD inventory before editing

Every `Body` sets `m_bulletFlag = true`, and no source changes it. Thus both
`collideA` and `collideB` in `Solver.solveWorldTOI` are always true: the
non-bullet dynamic-pair skip cannot run. The later island skip also cannot
run because it requires two non-bullet bodies. Remove those unreachable
checks and the constant body flag while retaining the TOI loop, contact
limits, sweep advancement and response. `Contact.m_bulletHitFlag` is
initialized/reset but never read or changed otherwise, so remove it too.
This is sensitive to fast collision guarantees; existing tiny-body, moving
obstacle, trigger and multiple-impact tests must pass before accepting it.

### Always-on CCD milestone (verified)

Removed the constant bullet flag, the unreachable non-bullet skips in the TOI
solver and its unused contact hit flag. Every current body still enters TOI
consideration; the solver's TOI, sweep, contact limits and response remain.
Collision tests covering tiny fast bodies, moving walls, triggers and
multiple impacts, typecheck and production build passed. Main chunk:
135,643 raw / 49,434 gzip-level-1 bytes; production TypeScript: 18,712
lines. Shared-tick medians: 1.675, 1.641 and 1.638 ms;
predicted-with-capture: 1.891, 1.853 and 1.860 ms. These overlap the
baseline range with ordinary run variation.

### One-proxy architecture inventory before editing

The user approved specializing fixtures to one proxy per collider. Both
remaining shape classes return exactly one child; the game represents compound
objects as multiple fixtures, not children within one fixture. `Fixture`
currently creates an array of one `FixtureProxy`, tracks an active count of
zero/one, and loops over it to create, destroy and synchronize broadphase
proxies. `FixtureProxy.childIndex` is always zero. World contact identity and
TOI proxy setup carry those zero indices; collision evaluator callbacks
already ignore them. Replace the array/count with one proxy and a negative
proxy-id inactive sentinel, and remove shape child-count/index methods and
contact index fields. Preserve fixture-pair duplicate detection and filtering,
broadphase move/destroy semantics, and circle/polygon proxy geometry.

Callers: `GameCollisions` owns fixture creation and dynamic outline refresh;
`Body` owns fixture lifecycle; `World` creates/persists contacts; `Solver`
reads shape distance proxies for TOI. Collision tests already cover compound
colliders, dynamic geometry, filters, nonphysical triggers, tiny fast bodies,
multiple impacts and moving obstacles. This change removes per-fixture array
allocation and index checks from hot collision paths; benchmark repeated
shared ticks after those tests.

### One-proxy architecture milestone (verified)

Each fixture now owns one proxy and uses its negative proxy id to represent
inactive broadphase state. Removed one-element proxy arrays, zero/one proxy
counts, shape child-count methods, constant child indices in contacts and TOI,
and loops over single proxies. Compound game objects still create separate
fixtures. Contact duplicate detection, filtering and swept AABB updates remain.
Collision tests, shared simulation/snapshot tests, typecheck and production
build passed. Main chunk: 134,809 raw / 49,133 gzip-level-1 bytes;
production TypeScript: 18,619 lines. Three shared-tick medians: 1.657, 1.647
and 1.595 ms; predicted-with-capture: 1.881, 1.876 and 1.819 ms. The ranges
overlap the fresh baseline. Remaining risk: any future shape with multiple
children will need a new fixture representation; this is the approved scope.

### Static-body reachability before editing

The user approved removing static bodies. `BodyDef.type` only permits dynamic
or kinematic, and the only world body creator, `GameCollisions`, selects those
from object mass. `Body.STATIC`, `Body.KINEMATIC` and `Body.DYNAMIC` static
aliases have no callers. Static-only velocity guards, seed/island skips,
fixture-sync skips and TOI awake checks therefore never take their static
branch. Keep the dynamic/kinematic distinction: massless game obstacles are
kinematic and can move; kinematic/kinematic pairs remain filtered by
`Body.shouldCollide`. Narrow `BodyType`, remove static-only branches and
aliases, preserve CCD/solver structure and test moving obstacles, filtering,
shared simulation and prediction before accepting.

### Static-body milestone (verified)

Removed unreachable static body type, constants, velocity guards and solver,
world and TOI branches. Dynamic bodies and massless kinematic obstacles retain
their distinct mass, motion and filtering behavior. Collision and prediction
tests, typecheck and production build passed; prediction reported matching
client contact poses. Main chunk: 134,402 raw / 49,032 gzip-level-1 bytes;
production TypeScript: 18,559 lines. Three shared-tick medians: 1.597, 1.641
and 1.637 ms; predicted-with-capture: 1.810, 1.863 and 1.851 ms. These
overlap or improve on the fresh baseline. Truly static bodies would need a new
implementation if introduced later, as approved.

### Compiler-unused declaration inventory before editing

A one-off `tsc --noUnusedLocals --noUnusedParameters` audit found five
items. In Planck-derived code, polygon contact's `_temp` scratch vector has
no reader, so remove its module-load allocation; the private contact position
solver never reads its `TimeStep` argument, and its two wrappers only forward
that argument, so remove the argument at both solver call sites. In game code,
the normal-build `benchmarkFlag` stub ignores its argument by design (the
benchmark build uses it); rename only that stub parameter. Prism's spectrum
loop uses the band index and not its element; mark the unused callback element.
The docked action selector only reads mount and module, so drop its unused
ship argument and the one corresponding call argument. None of these changes
alters contact calculations, rendered colors, benchmark switches or docked
actions; the removed polygon scratch vector reduces one allocation at module
load. Verify collision, prism and lazy docked tests.

### Compiler-unused milestone (verified)

Removed the polygon contact's unused scratch allocation and the contact
position solver's unused step argument through both call sites. Removed unused
client callback/call arguments while preserving benchmark build switch,
prism band selection and docked actions. `tsc --noUnusedLocals
--noUnusedParameters`, collision, prism and production lazy-docked tests,
typecheck and production build passed. Main chunk: 134,389 raw / 49,032
gzip-level-1 bytes; production TypeScript: 18,550 lines. Shared-tick medians:
1.649, 1.587 and 1.617 ms; predicted-with-capture: 1.886, 1.844 and
1.830 ms, overlapping the fresh baseline.

### Unread physics-state inventory before editing

`World.m_bodyCount` and `World.m_contactCount` are initialized and adjusted on
create/destroy, but no production or test code reads either counter. Remove
the fields and updates; the linked lists remain the source of bodies and
contacts. `Body.m_toiFlag` is initialized false but never read or changed;
remove it. This is distinct from `Contact.m_toiFlag`, which caches TOI results
and remains required. The removal saves per-world/body state and counter
updates without changing contact iteration or broadphase behavior.

### Unread physics-state milestone (verified)

Removed body and contact counters that were updated but never read, plus an
unused body TOI flag. Kept the contact TOI cache and linked-list traversal.
Collision tests, typecheck and production build passed. Main chunk: 134,211
raw / 48,967 gzip-level-1 bytes; production TypeScript: 18,540 lines.
Three shared-tick medians: 1.637, 1.643 and 1.649 ms;
predicted-with-capture: 1.860, 1.860 and 1.868 ms. These overlap the fresh
baseline.

### Remaining forwarding-helper inventory before editing

`BroadPhase.getUserData` and `BroadPhase.query` only forward to its dynamic
tree; no game, world, solver or test caller uses either wrapper. Keep the
underlying `DynamicTree.getUserData` and `query`, both used by pair discovery.
The broadphase's typed query callback import becomes unused after removing
its query wrapper. `physics-matrix.rotation` has one caller inside the same
file, `transform`, and no external caller; inline the identical sine/cosine
object there. This preserves scratch transform representation and avoids a
separate generic rotation factory. These are cold API simplifications; verify
collision and production output before accepting them.

### Forwarding-helper milestone (verified)

Removed unused broadphase user-data and query pass-through methods while
keeping tree-owned pair queries, and inlined the sole plain-rotation factory
call into scratch transform creation. Collision tests, typecheck and
production build passed. Main chunk: 134,096 raw / 48,918 gzip-level-1 bytes;
production TypeScript: 18,521 lines. Three shared-tick medians: 1.616, 1.641
and 1.621 ms; predicted-with-capture: 1.865, 1.873 and 1.869 ms. These
remain within the baseline range.

### Additional cleanup final verification

The full `npm test` suite passed, including collision, high-speed CCD,
nonphysical contacts, dynamic geometry, snapshots, server, rollback/prediction,
client/server compatibility, docked production chunk, rendering, prism and
input. `npm run lint`, `npm run format:check`, the stricter one-off TypeScript
unused-locals/parameters audit, final `npm run build` and `git diff --check`
passed. The final source scan found no obsolete Planck annotations, TODOs,
assert aliases, polygon cap, child-index/proxy-array plumbing, static-body or
constant active/bullet/fixed-rotation flags.

Final main chunk: 134,096 raw / 48,918 gzip-level-1 bytes versus this pass's
fresh baseline of 137,733 / 50,034, reductions of 3,637 raw and 1,116 gzip
bytes. Production TypeScript: 18,515 lines versus 18,915, down 400. Against
the earlier project baseline of 157,613 raw / 55,880 gzip bytes and 22,207
lines, reductions are 23,517 raw bytes, 6,962 gzip bytes and 3,692 lines.
Each functional milestone's repeated shared-tick and prediction medians
remained in the baseline range; there is no sustained shared benchmark
regression. Browser benchmarks remain omitted by user choice.

The approved architecture now requires one proxy per collider and only dynamic
or kinematic bodies. Adding a multi-child shape or genuinely static body in
the future will require an explicit implementation and its own collision
coverage. GJK shape distance, scalar point distance, and out-parameter vector
operations remain distinct where they calculate different results or avoid
solver allocations.

### Settings and modern-runtime pass: fresh baseline and reachability

At implementation time, the current Node runtime is v26.5.0. Fresh main
chunk: 134,096 raw / 48,918 gzip-level-1 bytes; sound chunk 1,691 raw and
docked chunk 5,631 raw, with the same three JavaScript requests and loading
triggers. Production TypeScript: 18,515 lines. Three shared-tick medians were
1.741, 1.720 and 1.659 ms; predicted-with-capture 1.972, 1.938 and
1.884 ms. Machine load varied, so the source baseline was copied to a
separate temporary checkout for alternating same-machine comparison later.

The single runtime mutation in `game-physics-settings.ts` sets
`Settings.velocityThreshold` to `5 * 0.01 = 0.05` solver units. The contact
solver is its sole reader. The game collision event path also uses the same
5-game-unit impact threshold, and all geometry conversion paths use the same
0.01 scale. Move these related constants into the existing collision types
owner and compute the solver threshold at its use site. This preserves the
coupling and removes import-order-dependent mutation and a tiny settings file.
The game physics module, contact solver and conversion paths are all in the
initial chunk; no lazy loading trigger or request count changes.

The generic `Settings` class is never mutated after removing that side
effect. `maxTOIContacts` has no reader. `maxManifoldPoints` only bounds a loop
over a fixed two-element contact-point array; use its actual length.
`aabbExtension` and `aabbMultiplier` belong to the dynamic tree. The
20-iteration GJK and TOI limits belong to their algorithms; the TOI contact
substep limit belongs to the solver. Translation/rotation caps and their
squares belong to the solver. Baumgarte factors and maximum position
correction belong to the contact solver. `linearSlop` is genuinely shared
across polygon construction, manifold generation, TOI and position solving;
keep one collision-owned value and derive polygon skin and squared tolerance
where used. Keep every numerical value and branch initially, then compare
collision behavior and shared performance before considering algorithmic
changes.

No physics source uses `Date`. The one production `Date.now()` call drives
a visual cargo-capacity pulse; simulation timing already uses
`performance.now()`. Temporal calendar/wall-clock types do not represent a
solver tick or monotonic animation duration, so no Temporal dependency is
proposed for this physics pass.

### Side-effect threshold milestone (verified)

Moved game unit scale and impact threshold to the existing collision constants
owner, removed `game-physics-settings.ts`, and made the solver compare relative
speed against the same `contactSpeedThreshold * physicsScale` value at its
use site. Removed the generic engine threshold and import-time mutation.
Collision tests, typecheck and production build passed. Main chunk: 134,025
raw / 48,874 gzip-level-1 bytes; production TypeScript: 18,504 lines.
Sound and docked chunks remain 1,691 and 5,631 raw bytes; the three request
triggers are unchanged. Three shared-tick medians: 1.596, 1.611 and
1.625 ms; predicted-with-capture: 1.814, 1.828 and 1.826 ms. The saved
baseline will be measured alternately with the final source to separate code
changes from machine-load variation.

### Generic Settings removal milestone (verified)

Deleted the Planck-style `Settings` class. Moved its genuinely shared
0.005 collision tolerance to the collision owner; kept tree fattening values
with the dynamic tree, CCD and iteration limits with their algorithms,
translation/rotation caps with the solver, and overlap correction values
with contact solving. The unused TOI contact count disappeared. Replaced the
fixed-two manifold limit with the actual two-point array length. All values
and formulas remain unchanged. The first typecheck exposed a local name
shadowing mistake, which was fixed before tests and build proceeded.
Collision and shared simulation/snapshot tests, typecheck and production
build then passed. Main chunk: 133,055 raw / 48,628 gzip-level-1 bytes;
production TypeScript: 18,398 lines. Sound and docked raw chunk sizes remain
1,691 and 5,631 bytes; requests and triggers are unchanged. Shared-tick
medians: 1.614, 1.592 and 1.625 ms; predicted-with-capture: 1.854, 1.822
and 1.851 ms. The final alternating comparison will check machine-load
variation against the saved baseline.

### Polygon hull arithmetic inventory and measured baseline

`PolygonShape._set` gift-wraps a welded convex hull. For every candidate edge
it allocates two `Vec2.sub` results only to compute one cross product and two
squared lengths; none escapes the loop. Circle/polygon narrow-phase, TOI and
solver code never read these temporary objects. The shape constructor owns
this work and the existing collision tests protect its output, including
20- and 30-vertex hulls and fast swept contacts. Replace only the two
short-lived vectors with scalar differences and the same arithmetic order;
keep the early-exit loops because hull choice depends on each comparison and
can change inside the traversal.

A reproducible Node 26 benchmark was added at `benchmarking/polygon-hull.mjs`.
Three pre-edit medians in microseconds per hull were 3.089/3.660/2.147 for
8 points, 10.005/9.963/10.072 for 20 points, and
21.561/21.470/21.536 for 30 points. The current algorithm creates two
intermediate vectors per candidate comparison, or roughly `2*n*n` objects
per convex `n`-point hull before welding/normals. The replacement should
remove those allocations without changing the hull or normal order.

### Polygon hull scalar milestone (verified)

Replaced two per-comparison temporary vectors in gift wrapping with scalar
coordinate differences in the same arithmetic order. Collision tests,
including 20/30-point hulls and fast swept contacts, typecheck and production
build passed. Three post-edit constructor medians in microseconds per hull
were 1.508/1.413/1.459 for 8 points, 2.348/2.288/2.848 for 20 points,
and 4.126/3.911/4.050 for 30 points. Against pre-edit medians, the
30-point case is about five times faster and avoids roughly 1,800 temporary
vectors per hull. Main chunk: 133,051 raw / 48,639 gzip-level-1 bytes,
a 4-byte raw reduction and 11-byte gzip increase from the preceding
milestone. Production TypeScript: 18,400 lines, two more for the clearer
scalar operations. Shared-tick medians were 1.639, 1.629 and 1.695 ms;
predicted-with-capture 1.932, 1.963 and 1.953 ms. These overlap the fresh
baseline; the shared tick does not construct hulls in its measured loop.
The overall chunk remains smaller than this pass's fresh baseline.

### Hot-loop alternative inventory

The retained solver and TOI code uses early-exit loops over two-point
manifolds and occasionally over larger polygon vertex arrays.
`benchmarking/physics-kernels.mjs` compares the same early-exit work on
Node 26.5.0. Three run medians were 6.616/6.720/8.338 ns for `for` versus
6.994/6.904/7.168 ns for `.some` on two points, and
22.732/22.746/22.788 ns versus 34.214/34.086/34.395 ns on 30 points.
The two-point case is indistinguishable at this scale; `.some` was about
50% slower at 30 points. The same benchmark measured
`Math.sqrt(dx*dx + dy*dy)` at 4.674/4.438/4.445 ns and `Math.hypot`
at 12.291/12.230/12.013 ns. These synthetic results do not warrant a
solver rewrite. Keep the early-exit loops and direct square root in hot
internal code; game `Vector.distanceTo` can retain `Math.hypot` for its
different numerical range semantics.

### Time-of-impact result inventory

`TimeOfImpact` has one production caller: `Solver.solveWorldTOI`. It reads
`TOIOutput.state` only to distinguish `e_touching` from every other state;
only a touching result uses the returned time. `e_unknown`, `e_failed`,
`e_overlapped`, `e_separated`, and `e_unset` are not observable by any
caller. Replace the six-state enum with a `touching` boolean reset for each
query. Keep the existing time values, branch control, root search, and
internal substeps. `TimeOfImpact.Input` and `.Output` are legacy function
properties with no source or test callers; constructors are imported
directly, so remove the aliases. These edits are in the initial chunk.
Collision tests cover physical and trigger sweeps, thin/moving obstacles,
multiple impacts, and fast small bodies; repeated shared benchmarks will
check the TOI hot path.

### Time-of-impact outcome milestone (verified)

Changed the TOI result to the sole distinction its solver caller observes:
`touching` or no usable impact. Removed six emitted numeric enum states
and unused function constructor aliases. All root search, sweep times,
branch control, and TOI substeps stay intact. Collision tests (including
fast triggers and physical contacts), shared simulation/snapshot tests,
typecheck, and production build passed. Three shared-tick medians were
1.635, 1.621 and 1.626 ms; predicted-with-capture medians were 1.861,
1.834 and 1.854 ms. Main chunk is 132,775 raw / 48,510 gzip-level-1
bytes; production TypeScript is 18,379 lines. This is 276 raw and 129
gzip bytes below the preceding milestone. The remaining risk is TOI
behavior in untested polygon geometry, addressed by the retained
algorithm and the full final collision suite.

### Collision tag inventory

Three numeric enums remain in the retained Planck-derived source.
`ManifoldType` is read by manifold generation/world conversion and the
contact solver; `ContactFeatureType` is used to construct persistent
feature IDs whose numeric values feed the warm-start key;
`SeparationFunctionType` selects TOI separating-axis cases. The source uses numeric enums, but the bundler may inline member values
and discard the runtime mapping when no dynamic lookup remains. Keep every
numeric tag and branch; compare the emitted build before changing the source.
These are hot first-frame paths, so collision tests, build size, and
repeated shared benchmarks must confirm any change.

### Collision tag representation investigation (no production change)

A read-only constant-map replacement passed collision tests and typecheck,
but increased the initial chunk from 132,775 / 48,510 to about 132,811 /
48,546 raw/gzip-level-1 bytes. A `const enum` replacement produced the
exact same chunk hash and size as the original enums. The bundler already
inlines these references and removes unreachable reverse mappings. Source
was restored; there is no runtime duplication to remove here. The final
shared benchmark remains the performance check.

### GJK scratch inventory

`Distance` is called only from synchronous `TimeOfImpact` and already uses
a module-owned `Simplex` scratch object. Each query also allocates two
arrays that store at most three previous support indices for cycle
detection. No array escapes or reaches gameplay state. Keep the duplicate
check and its exact iteration order, but reuse the two index arrays next
to the simplex. This removes two allocations per GJK distance query in
the continuous-contact path. The vectors in `Vector.distanceTo` and
`physics-matrix.distVec2` serve different APIs: game object method versus
allocation-free internal arithmetic. Their formulas also have different
overflow behavior (`Math.hypot` versus direct square root); do not merge
them as interchangeable calls.

### GJK scratch milestone (verified)

Moved the two per-query support-index arrays into the existing synchronous
Simplex scratch scope, removing two short-lived allocations per GJK
distance query. Collision tests, typecheck, and production build passed.
Three shared-tick medians were 1.617, 1.618 and 1.577 ms; predicted-with-
capture medians were 1.818, 1.829 and 1.814 ms. These overlap the prior
TOI milestone and show no sustained slowdown. Main chunk is 132,781 raw /
48,520 gzip-level-1 bytes, up 6 / 10 bytes from the prior milestone;
production TypeScript remains 18,379 lines. The scratch remains
nonreentrant, as the existing shared Simplex already was.

### Rotation wrapper inventory

`Rot` is constructed only as `Transform.q`, and its `setAngle` method is
called only by `Transform`. `Rot.identity()` has the same sole caller.
`physics-matrix.setRotAngle` already computes the same sine and cosine
into an existing rotation object. No game, network, or test API observes
the `Rot` class. Move its two-number value type into the transform module,
store `q` as a plain object, and call the existing matrix operation.
Preserve the identity value `(s=0,c=1)`, constructor behavior, and angle
updates. This should remove a standalone Planck class and file without
changing solver representations or allocations.

### Rotation wrapper milestone (verified)

Removed the one-use `Rot` class and `physics-rotation.ts`. `Transform`
now stores its sine/cosine pair directly and uses the existing
`setRotAngle` operation; its unused factory was replaced at the sole
body constructor call. Collision tests, typecheck, and production build
passed. Three shared-tick medians were 1.627, 1.615 and 1.627 ms;
predicted-with-capture medians were 1.864, 1.860 and 1.841 ms, within
the preceding milestone range. Main chunk: 132,623 raw / 48,474
gzip-level-1 bytes, down 158 / 46 bytes. Production TypeScript: 18,348
lines, down 31. The matrix's type-only transform import prevents a
runtime circular dependency.

## Verification before TOI wrapper consolidation (2026-09-24)

`npm test` passed, including shared/server/client prediction, queued
snapshot catch-up, asteroid splitting, physical/nonphysical CCD, thin and
moving obstacles, multiple impacts and speeds around and beyond the
translation cap. `npm run lint`, `npm run format:check`,
`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npm run build`,
and `git diff --check` passed. Lint initially found spacing in the two new
nonproduction benchmark scripts, and formatting flagged those scripts plus
two changed physics files; all four were fixed before the final checks.
The last build has 129 transformed modules and the same three JavaScript
request triggers. The main chunk is 132,623 raw / 48,474 gzip-level-1
bytes. Sound and docked remain about 1,691 and 5,631 raw bytes.
Production TypeScript is 18,348 lines.

Against the initial clean checkout, the main chunk fell by 24,990 raw
bytes (15.86%) and 7,406 gzip bytes (13.25%); production TypeScript fell
by 3,859 lines (17.38%). Against the fresh implementation-time baseline
of this follow-up (134,096 raw / 48,918 gzip bytes and 18,515 lines),
this pass removed another 1,473 raw bytes, 444 gzip bytes and 167 lines.

Alternating the saved fresh baseline and current source on the same
Node 26.5.0 machine gave shared tick medians of 1.650 / 1.648 /
1.713 ms for baseline and 1.621 / 1.656 / 1.611 ms for current.
Predicted-with-capture medians were 1.858 / 1.888 / 1.815 ms versus
1.829 / 1.867 / 1.855 ms. The median of each three-run group is
1.650 versus 1.621 ms for shared ticks and 1.858 versus 1.855 ms for
predicted ticks. There is no sustained shared-simulation slowdown in
these measurements. Browser measurement remains unavailable by the
user's choice to use shared benchmarks only; no browser performance
claim is made.

### TOI parameter wrapper inventory

`TOIInput` and `TOIOutput` are each instantiated once as persistent
solver scratch. Their fields are read only by `TimeOfImpact` and written
only by the solver/query; neither has behavior, subclassing, or a
network/game API. Use type-only interfaces and solver-owned object
literals instead. Keep the two `DistanceProxy` instances, two sweeps,
`touching` reset, `t` reset, and all TOI iteration behavior. This should
remove two emitted classes without per-query allocation.

### TOI parameter wrapper milestone (verified)

Replaced the two one-use TOI input/output classes with type-only
interfaces and persistent solver-owned objects. The query still reuses
two distance proxies and two sweeps and resets output before each call;
there is no new per-query allocation. Collision tests, full test suite,
typecheck, lint, formatting, strict unused-symbol check and production
build passed. The main chunk is 132,595 raw / 48,451 gzip-level-1 bytes,
down 28 / 23 bytes from the previous milestone. Production TypeScript is
18,353 lines (five more source lines for explicit scratch initialization).
Three immediate current shared-tick medians were 1.634, 1.698, 1.684 ms
and predicted-with-capture medians were 1.900, 1.891, 1.937 ms. Because
these exceeded the prior group, two alternating baseline/current pairs
were run: shared ticks 1.699/1.629 and 1.678/1.678 ms; predicted ticks
1.864/1.854 and 1.964/1.924 ms. The increase tracked machine load; no
sustained slowdown appeared against the fresh baseline.

## Final measured state (2026-09-24)

The production build before the syntax pass transforms 129 modules and
preserves the same three JavaScript request triggers. Initial index chunk:
132,595 raw / 48,451 gzip-level-1 bytes. Sound and docked chunks remain
about 1,691 and 5,631 raw bytes. Production TypeScript after formatting:
18,357 lines. Against the original clean checkout these are reductions
of 25,018 raw bytes (15.87%), 7,429 gzip bytes (13.29%) and 3,850
source lines (17.34%). Against that pass's fresh implementation-time
baseline they are reductions of 1,501 raw bytes, 467 gzip bytes and
158 lines.

The final full test suite, typecheck, lint, formatting, strict unused
symbol check, production build and diff whitespace check passed. The
latest alternating benchmark pairs and the preceding three-run
comparison show no sustained shared-simulation regression. Browser
benchmarking remains omitted under the user's instruction to use shared
benchmarks only.

## TypeScript syntax modernization inventory (2026-09-24)

A fresh `npm run build` passes at 132,595 raw / 48,451 gzip-level-1
bytes for the initial chunk and 18,357 production TypeScript lines.
Three fresh shared-tick medians are 1.680, 1.671 and 1.694 ms;
predicted-with-capture medians are 1.886, 1.875 and 1.946 ms. A source
snapshot at `/tmp/unicorn-style-baseline-puystagk` supports alternating
measurements on the same machine if a timing difference appears.

The TypeScript 7 scanner finds 175 numeric literals written as whole
number decimals (`0.0`, `1.0`, etc.) across 14 files in `shared/common`,
`shared/collision` and `shared/dynamics`. The one additional text match
is a comment. No numeric token is followed by a property-access dot.
All 175 spellings represent exactly the same JavaScript number when
shortened; their callers, including manifold generation, GJK/TOI, broad
phase and impulse solving, keep the same formulas and evaluation order.
The owner is the current algorithm in each file. Replace only numeric
tokens, leaving nonintegral decimals and explanatory comments intact.
The emitter should produce the same chunk hash; collision and repeated
shared benchmarks will verify that expectation.

Nine initialized, mutable primitive class fields in the physics source
have redundant `number`/`boolean` annotations: one tree height, five
solver step fields, one manifold point count, and two simplex cache fields
(nine total). TypeScript infers the widened field type from these
initializers. Remove only these annotations in a later milestone after
typecheck. Boolean-returning solver and body methods also have 22
`== false`/`== true` comparisons and two `? true : false` wrappers.
Simplify only operands statically typed `boolean`. Preserve intentional
`=== false`/`!== false` checks on optional gameplay flags and the tree
query callback: those distinguish false from an absent value. Preserve
`== null` where it deliberately checks both null and undefined.

Indexed solver loops, preincrement and mutable scratch vectors have
performance or in-place-update roles. The earlier Node 26 kernel
benchmark showed `.some` slower on a 30-element early-exit path, so no
bulk loop-to-array-method rewrite is proposed. Existing nonintegral
decimals such as friction 0.01 and tolerance 0.005 carry mathematical
values and remain.

### Integral decimal spelling milestone (verified)

Replaced 175 parsed whole-number decimal tokens across 14 physics
files with ordinary integer spelling. Nonintegral values and the one
comment match were untouched. Collision tests, typecheck and production
build passed. The emitted main, sound and docked chunk hashes and sizes
are exactly identical to the fresh baseline (`index-MJGj3PFz.js`,
132,595 raw / 48,451 gzip-level-1 bytes), so runtime mathematics and
allocations are byte-for-byte unchanged. Three post-edit shared-tick
medians were 1.611, 1.857 and 1.922 ms; predicted-with-capture medians
were 2.040, 2.106 and 2.163 ms. That spread reflects machine-load
variation, not an emitted-code change; the baseline/current comparison
will be repeated after the syntax cleanup. Production TypeScript stays
at 18,357 lines. No collision or numerical risk remains from this
lexical milestone.

### Inferred fields and boolean expressions milestone (verified)

Removed nine redundant primitive field annotations and simplified
boolean-typed comparisons/ternaries in the solver, world, contact,
body, manifold, cache and tree code. `Body.isWorldLocked` now calls its
always-present world directly. Optional false checks on gameplay
colliders and tree callbacks remain. Collision tests, typecheck and
production build passed. Main chunk: 132,527 raw / 48,409 gzip-level-1
bytes, 68 / 42 bytes below the fresh baseline. Production TypeScript
remains 18,357 lines; the edits are within lines. Three alternating
baseline/current shared-tick pairs were 1.650/1.922, 1.911/1.908 and
1.940/1.939 ms. Predicted-with-capture pairs were 2.184/2.155,
2.183/2.205 and 2.215/2.170 ms. The first pair straddled a machine
load change; the subsequent pairs align and show no sustained slowdown.
The remaining risks are source type inference at API boundaries and
uncovered boolean edge cases; the final full suite and strict unused
symbol check will cover those.

### Equality operator inventory

The TypeScript scanner finds 23 remaining non-null loose comparisons in
physics source. They compare two numbers (counts, time step, density),
two body type strings, or object identity (contacts, bodies, fixtures,
contact edges). Their types are established inside the solver and no
coercion is intended. Convert these to `===`/`!==`, retaining expression
order and callers. Fifteen `== null`/`!= null` checks intentionally
cover both null and undefined in linked-list/scratch paths; leave those
unchanged. The source comment mentioning `dt == 0` is not executable
and needs no rewrite. This edit may add bytes to emitted comparisons,
so measure the build and retain only if the size/performance result is
reasonable against the overall goals.

### Typed strict equality milestone (verified)

Changed 23 parsed comparisons of statically matched primitive or object
types to `===`/`!==`, preserving the fifteen deliberate nullish checks.
Updated the remaining explanatory `0.0` comment to `0`. Collision
tests, typecheck and production build passed. Main chunk: 132,550 raw /
48,417 gzip-level-1 bytes, 23 / 8 bytes above the preceding milestone
but 45 / 34 bytes below the fresh implementation baseline. Production
TypeScript remains 18,357 lines. Three alternating baseline/current
shared-tick pairs were 1.619/1.632, 1.621/1.644 and 1.632/1.623 ms;
predicted-with-capture pairs were 1.836/1.824, 1.844/1.855 and
1.845/1.844 ms. Differences are within the run-to-run range and do
not show a sustained slowdown. The full suite remains the final gate.

### Function-expression export inventory

Five retained algorithm entry points (`Distance`, `TimeOfImpact`,
`CollideCircles`, `CollidePolygonCircle`, `CollidePolygons`) are exported
as `const Name = function (...)`. Source and tests only call them as
functions; no property, `.prototype`, rebinding, or constructor use
reaches any of them. Their callers are the TOI query, solver and the
three registered narrow-phase contact paths. Convert each to a named
function declaration in its existing file. This removes vestigial
function-expression syntax without changing formulas, callbacks, or
loading boundaries. Keep public names in this milestone to avoid mixing
syntax cleanup with an API rename. Collision tests, chunk measurement
and repeated shared benchmarks will verify it.

### Named algorithm function milestone (verified)

Converted five exported algorithm function expressions to named function
declarations, retaining their names, parameters, bodies and callers.
Collision tests, typecheck and production build passed. Main chunk:
132,561 raw / 48,433 gzip-level-1 bytes. This is 11 / 16 bytes above
the previous milestone, but 34 / 18 bytes below the fresh baseline.
Production TypeScript remains 18,357 lines. Three alternating
baseline/current shared-tick pairs were 1.622/1.618, 1.645/1.640 and
1.618/1.630 ms; predicted-with-capture pairs were 1.842/1.846,
1.839/1.876 and 1.840/1.829 ms. No sustained slowdown is visible.
The remaining risk is an untested import/initialization order; the
full suite and production build are the final gates.

### Collision function naming inventory

Eight functions retain Planck-style PascalCase names despite being
ordinary callable functions: five exported geometry/TOI functions and
three shape-pair contact adapters registered with `Contact.addType`.
All callers are in `src/shared`; no test, client, server or network API
imports the old names directly. The contact registry stores the adapter
function references, not their names. Rename to `computeDistance`,
`findTimeOfImpact`, `collideCircles`, `collidePolygonCircle`,
`collidePolygons`, and `evaluate...Contact` names while preserving each
function body and registration. Update descriptive comments but keep
vendored-source URLs and license notices intact. This is source-level
terminology only; tests/build must confirm no missed imports.

### Collision function naming milestone (verified)

Renamed the five algorithm functions and three registered contact
adapters to verb-led camelCase names, keeping parameters, bodies,
registration and license URLs intact. An exploratory rename script
briefly matched JavaScript's inherited `toString` property in seven
unrelated positions; those were restored before any verification, and
the unrelated files match the saved source snapshot. Typecheck,
collision tests and production build passed. The emitted initial chunk
hash and size are unchanged from the prior milestone
(`index-CZPyg4Ab.js`, 132,561 raw / 48,433 gzip-level-1 bytes). Three
alternating baseline/current shared-tick pairs were 1.634/1.636,
1.630/1.604 and 1.625/1.637 ms; predicted-with-capture pairs were
1.830/1.843, 1.855/1.841 and 1.828/1.853 ms. No sustained slowdown is
visible. Source lines remain 18,357.

### Remaining initializer type inventory

A whole-source search finds one remaining initialized mutable primitive
field annotation, `Craft.kind: string = 'craft'`, and one defaulted
physics parameter, `Sweep.getTransform(beta: number = 0)`. `Craft.kind`
is overridden by `Ship` and `Station`, so the important requirement is
that inference keep the base property widened to `string`, not the
literal `'craft'`; TypeScript typecheck will establish that. The sweep
parameter's numeric default already supplies its type. Removing these
annotations changes no runtime value or call and should leave the
production chunk identical. Explicit parameter and return types on
public solver APIs remain where they document contracts or cannot be
inferred from a default.

### Final initializer inference milestone (verified)

Removed the redundant type annotation from mutable `Craft.kind` and the
defaulted `Sweep.getTransform` parameter. Typecheck confirms the craft
field remains compatible with `Ship` and `Station`; shared object tests,
collision tests and production build passed. The production chunk hash
and size are unchanged (`index-CZPyg4Ab.js`, 132,561 raw / 48,433
gzip-level-1 bytes), and production source stays at 18,357 lines. Three
shared-tick medians were 1.626, 1.628 and 1.673 ms; predicted-with-
capture medians were 1.822, 1.844 and 1.959 ms. These overlap the
preceding paired runs. No runtime type or allocation change is emitted.

## Final TypeScript syntax verification (2026-09-24)

`npm test` passed, including simulation, rollback, prediction, server,
client, cargo and collision cases. `npm run lint`, `npm run
format:check`, `npx tsc --noEmit --noUnusedLocals
--noUnusedParameters`, and `npm run build` passed. Formatting
initially flagged three touched collision files; targeted formatting
resolved all three before final build. `git diff --check` passed. A
whole-source scan now finds no `.0` whole-number decimal spelling,
`var`, boolean ternary wrapper or unintended `toString` replacement.
The only remaining loose physics comparisons are deliberate nullish
checks.

The final initial chunk is `index-CZPyg4Ab.js`: 132,561 raw / 48,433
gzip-level-1 bytes, down 34 raw and 18 gzip bytes from this turn's
fresh baseline. Sound and docked chunks and the three request triggers
are unchanged. Production TypeScript is 18,362 lines, five above the
fresh baseline because the formatter expanded three touched functions.
Against the original clean checkout for the overall physics project,
the initial chunk is down 25,052 raw bytes (15.89%) and 7,447 gzip
bytes (13.33%); production TypeScript is down 3,845 lines (17.31%).

The last three alternating baseline/current shared-tick pairs were
1.634/1.636, 1.630/1.604 and 1.625/1.637 ms. Predicted-with-capture
pairs were 1.830/1.843, 1.855/1.841 and 1.828/1.853 ms. There is no
sustained shared-simulation regression in those measurements. The
0.0-spelling and inferred-type stages emitted identical chunk hashes
to their prior stages; the final naming stage also left the chunk hash
unchanged. Browser benchmarking remains omitted under the user's
instruction to use shared benchmarks only.

## Native game units, cargo pickup, and friction inventory (2026-09-24)

Fresh same-machine baseline: `npm run build` passed with initial
`index-CZPyg4Ab.js` at 132,561 raw / 48,433 gzip-level-1 bytes;
production TypeScript is 18,362 lines. Three shared-tick medians were
1.602, 1.628 and 1.632 ms; predicted-with-capture 1.834, 1.831 and
1.870 ms. Source and benchmark scripts were saved at
`/tmp/unicorn-units-baseline-ngbu9l5a` for alternating comparison.
Browser measurements remain omitted at the user's request.

| Behavior                                     | Callers and reachability                                                                                                                                                                                                  | Replacement and risk                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultFriction = 0.01`                     | `GameObject` static/instance defaults, fixture constructor, and two `GameCollisions` fallbacks. Every production fixture is created by `GameCollisions`; physical hitboxes come from `GameObject`, `Craft` or `Asteroid`. | Own the default directly on `GameObject`; keep explicit subclass overrides and explicit zero. Require a friction value when creating a physical fixture and stop substituting defaults in the contact path. Nested asteroid colliders must inherit the parent material.                                                                                                                                                                            |
| `physicsScale = 0.01`                        | `GameCollisions` transforms/velocities/contacts, read-only `contactBetween`, `physicsShape` collision margin, and the low-speed restitution threshold. Nothing outside the collision adapter uses solver units.           | Use game units inside the solver and remove all boundary conversion. Rescale dimensional constants: `linearSlop` 0.005→0.5, polygon skin 0.01→1, AABB extension 0.1→10, max translation 2→200, contact-speed threshold 0.05→5. Keep rotation/time/mass and dimensionless iteration limits. Geometry cache quantization must remain equivalent at 1e-6 game units. CCD, thin obstacles, multiple impacts, damage and performance need verification. |
| `linearSlop` in `collision/types.ts`         | Polygon welding/skin, manifold edge tolerance, TOI target, position solver.                                                                                                                                               | Move to a shared physics-constants owner outside the collider type module. It is a physical length tolerance, not a collider field.                                                                                                                                                                                                                                                                                                                |
| `collisionCategories` and category/mask bits | Item's zero-radius pickup trigger and craft cargo mouth are the only nondefault masks; fixture filtering and diagnostic query duplicate the bit test.                                                                     | Remove categories once pickup pairing is owned by the cargo hatch. A centre trigger may still be needed for swept pickup timing; the user is deciding that material choice. Broadphase contact count and filtering must be measured.                                                                                                                                                                                                               |

The `EPSILON = 1e-9` uses are numerical degeneracy/TOI-fraction
checks, not contact skin; they are separately audited during the unit
change. The only saved/networked material change is friction, already
optional on wire snapshots; internal unit conversion is not serialized.
Milestones proceed friction, native units, then pickup filtering so each
change can be verified independently.

### Object-owned friction milestone (verified)

Removed `defaultFriction` and made the `GameObject` static material value
(0.01) the source of an instance's inherited friction. Physical and
nonphysical production colliders now carry a material value; fixture
construction requires it and contact solving no longer substitutes a
default. Craft and asteroid overrides, nested asteroid materials and
explicit zero remain. A simulation test initially expected the
nonphysical drill-tip collider's friction field to be absent; it now
checks the inherited value while separately checking that the tip has
no physical response. Collision, simulation/snapshot tests, typecheck
and production build then passed. Main chunk: 132,627 raw / 48,460
gzip-level-1 bytes, 66 / 27 above the fresh baseline; production
TypeScript: 18,361 lines. Three alternating baseline/current shared-
tick pairs were 1.614/1.619, 1.637/1.630 and 1.629/1.646 ms;
predicted-with-capture pairs were 1.846/1.883, 1.827/1.843 and
1.835/1.861 ms. Shared performance is within run variation; the
small predicted difference needs the final alternating comparison.
Remaining risk: custom JavaScript test colliders can bypass the
TypeScript material contract; the two nonphysical test fixtures were
updated to supply friction.

### Native-unit constant audit before implementation

Further source tracing found two more dimensional constants: the solver's
maximum position correction `0.2` metres must become 20 game units,
and the three invalid-polygon fallback boxes of half-size 1 metre must
become half-size 100 game units. The dynamic tree's AABB extension is
0.1 metre (10 game units); the maximum translation is 2 metres (200
game units). The shape-cache rounding step is 1e-8 solver units (1e-6
game units) and must be updated with the conversion removal. Angular
limits, masses, time fractions, friction, restitution and iteration
counts are dimensionless or use unchanged dimensions. `EPSILON` is
a near-zero numerical guard in GJK/manifold cases and a unitless TOI
fraction guard; its uses will be checked separately rather than
rescaling them all as a single setting.

### Native game units milestone (verified)

Removed `physicsScale` and its boundary conversions. Physics shapes,
transforms, velocities, contact points and depths now use game units.
Moved `linearSlop` and the contact-speed threshold into shared physics
settings, converted the dimensional constants listed above, and kept
the same shape-cache precision in game units. Collision, shared
simulation/snapshot, prediction, typecheck and production build passed.
The prediction test replayed 612 ticks with zero worst ship correction.
The main chunk is 132,550 raw / 48,402 gzip-level-1 bytes, 11 / 31
below this turn's fresh baseline. Production TypeScript is 18,338 lines,
24 below baseline. Three alternating baseline/current shared-tick
medians were 1.644/1.673, 1.707/1.641 and 1.643/1.645 ms; predicted-
with-capture medians were 1.872/1.890, 1.870/1.866 and 1.858/1.854 ms.
The first pair overlapped the tail of the prediction test, so the later
two uncontended pairs carry more weight. They show no sustained
slowdown. Remaining risk: contact outcomes at numerical degeneracies
need the final high-speed and full-suite checks.

### Cargo contact filter reachability before implementation

The only production category/mask overrides are the item's centre trigger
and the craft cargo throat. All other colliders take the solid default.
`FixtureOpt.filterGroupIndex` has no caller; the fixture constructor's
category defaults and `Fixture.shouldCollide` bit tests only serve those
two overrides. The read-only diagnostic query repeats the same bit test.
Replace both paths with one generic per-collider contact predicate owned
by the cargo-hatch module. Keep the centre trigger and mouth tags so
swept pickup timing and open/closed filtering retain their behavior.
`GameCollisions` must still rebuild a fixture if the contact role changes
because fixture filtering is applied when a contact is created.

### Cargo contact filter milestone (verified)

Removed `collisionCategories`, collider category/mask fields, unused
fixture group filtering and duplicate bit tests in the diagnostic query.
The cargo-hatch module now owns a generic zero-radius item centre
trigger and its pickup pair rule. The fixture and diagnostic paths use
one generic per-collider contact predicate. The cargo mouth accepts
only the centre trigger; the centre trigger accepts only a cargo mouth.
The fixture geometry key records the pickup/mouth role, retaining the
old rebuild behavior when filtering changes. Collision tests, including
fast swept pickup, filtering in both directions and absence of impulse,
shared simulation/snapshot tests, typecheck and production build passed.
The main chunk is 132,104 raw / 48,340 gzip-level-1 bytes, 457 / 93
below this turn's baseline; production TypeScript is 18,297 lines,
65 below baseline. Three alternating baseline/current shared-tick
medians after the ordinary-contact fast path were 1.758/1.643,
1.684/1.695 and 1.707/1.675 ms; predicted-with-capture medians were
1.849/1.951, 1.858/1.901 and 1.925/1.896 ms. Predicted results vary
across pairs and do not establish a sustained slowdown. The final
comparison and full suite remain to run.

### Server pickup check investigation

The first full-suite run stopped at the server integration test's cargo
collection timeout. The saved pre-edit source passed that test. Live
tracing showed the test placed a split asteroid item at the still-closed
mouth immediately after a horn-drill impact. The ship was still moving;
under native units the item's centre had drifted 25 game units from the
mouth by the time it opened (throat radius 12). The old numeric scale
produced a different post-impact trajectory and happened to leave the
item near the mouth. The cargo contact filter itself passed the direct
swept-contact test. The server test now waits for an active open mouth,
places the item there with ship velocity, and verifies collection over
the live networked simulation. This passes. The changed trajectory in
that complex impact is a remaining behavior risk; exact old floating-
point outcomes are not promised by native-unit arithmetic. The final
collision and gameplay checks must still pass.

### Final audit and verification for this pass

The remaining `ShapeType` members are only `circle` and `polygon`.
No production reference remains to `physicsScale`, `defaultFriction`,
`collisionCategories`, collider category/mask fields, fixture filter bits,
`@internal`, `@hidden`, `@deprecated`, `_ASSERT`, `console.assert`,
`math_max`, the stale shape-interface TODO, or `0.0` literals in the
Planck-derived collision/dynamics/common code. Remaining `while` loops
implement dynamic-tree walks, linked contact lists, or iterative GJK/TOI
searches with early exits. Replacing these with array callbacks would
require materializing arrays or obscure their stopping conditions.
`Vector.distanceTo` serves game code; the solver's two `distVec2` uses
operate on scratch values inside GJK/TOI, so retaining its direct
scalar calculation avoids a new allocation or method binding. The
solver's squared-distance helper likewise avoids square roots in its
four narrow-phase callers. This is an intentional hot-path API
boundary, not a second vector representation.

After the server pickup test was made independent of the preceding
post-impact trajectory, `npm test` passed (shared, simulation,
snapshots, regions, server, prediction, collision, docked, prism,
sound and input). `npm run lint`, `npm run format:check`, strict TypeScript
unused-symbol checking, `git diff --check` and `npm run build` passed.
Collision tests cover tiny/fast bodies, moving thin obstacles,
multiple impacts, crossings around and beyond the 200-unit translation
cap, nonphysical triggers without impulses, filtering and asteroid
splitting. Prediction exercises rollback, queued snapshots and two
clients; input tests cover catch-up after long stalls. The final
chunk remains 132,104 raw / 48,340 gzip-level-1 bytes and production
TypeScript 18,297 lines. Against the original consolidation baseline
(157,613 raw / 55,880 gzip; 22,207 lines), reductions are 25,509 raw
bytes (16.2%), 7,540 gzip bytes (13.5%) and 3,910 production lines
(17.6%). Against the fresh implementation-time baseline, reductions
are 457 raw bytes, 93 gzip bytes and 65 lines. The final three paired
shared benchmarks are recorded in the cargo milestone above; tick
measurements overlap the same-machine baseline and the predicted
measurements are mixed, with no sustained regression established.
Browser benchmarking was omitted by the user's choice. The native-unit
change can alter exact floating-point trajectories after a complex
impact, as the server test investigation shows, while contact and
pickup behaviors remain verified.

## Numeric collision tag audit (2026-09-24)

Fresh implementation-time baseline: `npm run build` passes; main chunk
132,104 raw / 48,340 gzip-level-1 bytes, 18,286 production TypeScript
lines, 131 transformed modules. Saved source and benchmark script at
`/tmp/unicorn-enum-baseline-vfn0523u` for paired measurements. The prior
read-only trial found a constant object 36 bytes larger in both raw and
gzip output; a `const enum` emitted identical output. The three remaining
numeric enums are internal to the Planck-derived collision solver:

| Enum                     | Callers and behavior                                                                                                                                                             | Persistence and performance                                                                                             | Proposed owner                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ManifoldType`           | Circle/polygon contact generators set circle, face-A or face-B; world-manifold and position solver switch on it. The unset value only resets pooled objects.                     | Stored across physics steps for warm starting, but never serialized or put on the wire. Hot contact path.               | A plain discriminant on the manifold and position solver, with the same three branches and an empty reset state. |
| `ContactFeatureType`     | Contact generators and clipping label a vertex or face. `ContactID` includes its `0`/`1` value in a compact numeric warm-start key and swaps labels when fixture order reverses. | The numeric key is internal but must remain exactly equal to preserve matching and impulses. Hot manifold construction. | Two scalar numeric literals for the key encoding, with a narrow TypeScript union; no runtime enum object.        |
| `SeparationFunctionType` | The TOI helper chooses points, face-A or face-B separation; the unset value only resets scratch state.                                                                           | Private to one file, not persisted. Hot CCD path and multiple-impact cases.                                             | A plain discriminant on the scratch helper, preserving branch behavior.                                          |

The `updateTiers` object holds scheduling parameters rather than enum
values; its numbers encode visible/distant update cadence and are not
part of this change. Other `as const` usages are color palettes, wire
string tags, and field-name lists. No numeric enum value is used in
saved, rollback or network data. Replace tags only if collision, build,
size and paired shared benchmarks support the change.

### Numeric enum removal milestone (verified)

Removed all three numeric TypeScript enums. Manifold and TOI branch
states are string literal unions with `undefined` for recycled scratch.
Contact feature labels use two scalar `0`/`1` constants because those
values are part of the unchanged numeric warm-start key; their type is
private and excludes the unset sentinel when creating a feature ID.
No source `enum` declaration remains. A private string-tag trial for
TOI alone added 18 gzip bytes, while scalar numeric constants there
added 46 gzip bytes. The combined replacement was smaller overall.
The final build is 131,754 raw / 48,256 gzip-level-1 bytes, down 350 /
84 from the fresh baseline; production TypeScript is 18,272 lines,
down 14. No loading trigger changed.

Collision tests and the full `npm test` suite passed, covering CCD,
multiple impacts, tiny fast bodies, filtering, server pickup, snapshots,
rollback/prediction and client/server gameplay. Lint and strict unused-
symbol TypeScript checks passed. Three alternating baseline/current
shared-tick medians were 1.489/1.494, 1.481/1.479 and 1.508/1.531 ms;
predicted-with-capture medians were 1.706/1.680, 1.714/1.695 and
1.702/1.736 ms. These overlap run variation and show no sustained
slowdown. The warm-start key formula and numeric feature values remain
unchanged. Remaining risk is the usual contact hot-path sensitivity;
there was no observed regression in repeated shared measurements.

## Numerical guard and clamp audit (2026-09-24)

Fresh implementation-time baseline: `npm run build` passed, main chunk
131,754 raw / 48,256 gzip-level-1 bytes and 18,272 production TypeScript
lines. Source and benchmark script were saved at
`/tmp/unicorn-guard-baseline-sh8g6v1u`. This audit precedes editing.

| Expression                           | Caller and purpose                                                                                                                                                                                | Decision                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `lengthSqr > EPSILON * EPSILON`      | `Manifold.getWorldManifold`: normalize a circle-centre difference. Near coincident centres have an unstable direction; the fallback normal avoids amplifying subnanounit noise. Hot contact path. | Keep a squared-distance threshold local to the manifold; an exact-zero test would normalize nearly zero noise.                     |
| `lengthSqr < EPSILON * EPSILON`      | GJK `computeDistance`: stop when the simplex search direction has collapsed. TOI needs a stable distance witness, especially for small fast shapes. Hot CCD path.                                 | Keep a named squared-distance guard local to GJK.                                                                                  |
| `metric2 < EPSILON`                  | GJK simplex cache read: reject a nearly collapsed cached simplex before barycentric solving. The cache is internal, not saved/networked.                                                          | Keep a local degeneracy guard.                                                                                                     |
| `separation < EPSILON`               | Circle/polygon narrow phase: classify a centre on or inside the polygon's separating face.                                                                                                        | Use `separation <= 0`; the 1e-9 positive band is far below physical slop and is not needed for this geometric branch.              |
| `1 - 10 * EPSILON < minAlpha`        | TOI solver: stop when the next hit is within 1e-8 of the tick end. This avoids a practically zero-length substep; the solver's maximum internal substeps remain.                                  | Keep the near-end threshold as a named TOI fraction, preserving contact timing and bounded work.                                   |
| `clamp(C, -20, 0)`                   | Position solver: only correct penetration and limit a single correction to 20 game units.                                                                                                         | Keep both bounds; removing them can pull bodies together or make a deep overlap jump violently. Inline with `Math.min`/`Math.max`. |
| `clamp(tangentImpulse, -mu*N, mu*N)` | Velocity solver: cap the friction impulse by the normal impulse.                                                                                                                                  | Keep both bounds; otherwise even a zero-friction surface gains tangential grip. Inline with `Math.min`/`Math.max`.                 |

No guard or bound is serialized. The proposed changes preserve the
Coulomb friction limit, position correction cap, GJK/TOI safety and
continuous collision behavior. Collision, full gameplay and repeated
shared benchmarks must verify the simplification.

### Numerical guard and clamp simplification (verified)

Removed the global `EPSILON` constant and the two-call `clamp` helper by
deleting `physics-math.ts`. Circle/polygon contact now uses
`separation <= 0`, preserving the exact-boundary case without the
unnecessary 1e-9 positive band. The GJK search direction, simplex
cache and near-coincident circle normal retain their safeguards as
named local thresholds. Their squared thresholds are 1e-18 because
the compared values are squared lengths; testing only against zero
would let floating-point noise choose a normal or support point. The
TOI end-of-tick guard remains 1e-8 as a named fraction, preserving the
old short-substep cutoff. Position correction still stays between -20
and 0 game units per solve, and tangent impulse still stays within the
friction limit. Those bounds now use `Math.min`/`Math.max` directly;
removing the bounds would change penetration and sliding behavior.

Collision tests, the full `npm test` suite, typecheck, lint and strict
unused-symbol checks passed. The main chunk is 131,761 raw / 48,252
gzip-level-1 bytes, 7 raw bytes above and 4 gzip bytes below the fresh
baseline. Production TypeScript is 18,202 lines, down 70; transformed
modules fell from 131 to 130. No new allocation is introduced. Three
alternating baseline/current shared-tick medians were 1.488/1.483,
1.479/1.493 and 1.479/1.450 ms; predicted-with-capture medians were
1.717/1.725, 1.744/1.694 and 1.676/1.658 ms. No sustained slowdown
appears in these repeated shared measurements. The retained guards
cover numerical degeneracy; they are deliberately local rather than
a single cross-dimensional global epsilon.

## Direct collider shape construction (2026-09-24)

Fresh implementation-time baseline: `npm run build` passed, main chunk
131,761 raw / 48,252 gzip-level-1 bytes, 18,202 production TypeScript
lines and 130 transformed modules. Source and benchmark script are at
`/tmp/unicorn-shape-baseline-mf2scrw8` for paired measurement.

| Implementation                         | Callers and behavior                                                                                                                                                                                                       | Sensitivity and replacement                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `physicsShape` in its own module       | Only `GameCollisions.sync` and the read-only `contactBetween` query. It branches on a local point-array versus circle object, constructs the solver shape and sets polygon `m_radius` when `collisionMargin` is specified. | In the hot fixture rebuild path and initial JS chunk. Construct the explicit collider shape at the fixture owner; no generic adapter or separate module is needed.                          |
| `contactBetween` local `shape` closure | Creates two solver shapes for a diagnostic pair, using the same adapter. This query is reached by tests/diagnostics, not gameplay collision steps.                                                                         | Build two shapes directly from each collider's outline or circle radius, preserving the same narrow-phase algorithms and contact skin.                                                      |
| `PolygonShape.m_radius` override       | Asteroid segments set `collisionMargin: 0` so split pieces have no padded collision overlap. Other polygons use the existing `2 * linearSlop` skin. Circles use their authored radius and ignore polygon margin.           | Accept an optional margin in the polygon constructor, preserving explicit zero and the default; retain the margin in `GameCollisions`' geometry cache key so changing it rebuilds fixtures. |

`GameObject`, `Craft`, `Asteroid` and the cargo pickup point already
express their geometry through `outline` or a circle `radius`. No shape
kind is serialized or sent over the network. The fixture adapter must
still apply the existing local offset and rotation, filter degenerate
polygons, and keep all physical/nonphysical contact behavior. Collision,
asteroid-splitting, server/prediction, build and repeated shared
benchmarks will verify the replacement.

### Direct collider shape milestone (verified)

Deleted `physics-shape.ts` and its generic `physicsShape` function.
`GameCollisions` now creates a `CircleShape` or `PolygonShape` directly
from its already prepared collider geometry. The read-only
`contactBetween` query constructs the two authored collider shapes at
its pair site. `PolygonShape` accepts the optional collision margin in
its constructor; omitted margins still use `2 * linearSlop`, while an
explicit asteroid margin of zero remains zero. Geometry-key rebuilds,
local offsets, rotations, physical/nonphysical response and the same
circle/polygon narrow phase remain. This removes one transformed
module without a new per-tick shape allocation; the diagnostic query's
small pair array is outside production gameplay.

Collision tests, the full `npm test` suite, typecheck, lint and strict
unused-symbol checks passed. The main chunk is 131,688 raw / 48,214
gzip-level-1 bytes, down 73 / 38 from this milestone's fresh baseline.
Production TypeScript is 18,184 lines, down 18; transformed modules
fell from 130 to 129. Three alternating baseline/current shared-tick
medians were 1.478/1.479, 1.503/1.482 and 1.486/1.499 ms;
predicted-with-capture medians were 1.681/1.682, 1.717/1.703 and
1.704/1.725 ms. No sustained shared slowdown appears. No remaining
`physicsShape` caller exists. The only retained special case is the
intentional polygon collision margin used by split asteroid pieces.

## Asteroid fracture rendering regression (2026-09-25)

A drill-path reproduction showed one `asteroidSplit` event and two unique child
IDs when an inner segment broke. The asteroid's mass, segment area and cargo
were conserved. The apparent duplicates came from presentation: the remaining
segmented asteroid could have an interior hole, but `outlineFrom` kept only its
outer loop and the renderer filled the removed area again. Repeated cuts can
create several holes that meet at a corner; the old undirected edge walk also
joined the wrong boundaries there. The same rendering defect was present in
the checked-in source before this physics refactor. Server region sync removes
the procedural parent, and prediction reconciliation removes speculative IDs;
neither path reproduced duplicate entities in the controlled case.

The shared asteroid boundary walk now retains every exterior loop, following
the next clockwise edge when loops meet at a vertex. It reuses `outerEdges`
for edge marking and connected groups, replacing a second implementation of
shared-edge grouping. Fracture uses the already marked edges; rendering
rebuilds marks when it receives copied segments from prediction. The renderer
fills the loops with the even-odd rule, so drilled holes remain empty, and
strokes the same boundaries. Segment colliders and their CCD response are
unchanged. No saved or network field changed.

The new regression tests drill an interior segment, assert one split and two
children, check the rendered fill after a prediction-state copy, and compare
boundary area with surviving segment area through repeated interior cuts. An
additional local sweep checked 633 connected asteroid fragments across 20
seeds, including finite child positions and radii; all passed. The full
`npm test` suite, typecheck, lint, formatting check and production build passed.
The initial chunk changed from the fresh 131,688 raw / 48,214 gzip-level-1
bytes to 131,638 raw / 48,230 gzip-level-1 bytes. Production TypeScript lines
changed from 18,184 to 18,190. Loading triggers are unchanged.

A paired shared benchmark used a reconstructed pre-fix source copy with the
same current engine and build configuration. Shared-tick medians were
1.468/1.460, 1.469/1.475 and 1.480/1.462 ms (before/after); predicted-with-
capture medians were 1.672/1.663, 1.685/1.678 and 1.682/1.678 ms. No sustained
shared-tick regression appeared. A focused fracture setup measured about
0.136 ms per split versus 0.121 ms before; the remaining roughly 0.015 ms is
paid when a rock actually fractures, not every simulation tick. Browser
measurements remain excluded by the user's earlier choice to use shared
benchmarks only.

## Expanding shield contact response (2026-09-25)

A still ship extending its shield around an item at x=54 moved the item to
x≈55.4 without changing either body's velocity. The shield collider already
specified a tuned outward surface speed of 60, but no contact code consumed it,
and its old active/progress check missed the final expansion tick. The shared
solver now uses that speed as a normal velocity bias and includes it in the
restitution threshold. The simulation marks every tick in which the cover grows,
including the last tick. A later refinement stores the growth tick on the
segment, so the contact speed expires on the next tick without a global reset.
It continues to apply reciprocal impulses and keeps nonphysical contacts free
of response. Fully extended shields have zero surface speed.

The new regression test checks an item launched by expansion, ship recoil and
zero speed after expansion. Collision, simulation and prediction tests passed;
typecheck and the production build passed. The main chunk changed from the
fresh 131,638 raw / 48,230 gzip-level-1 bytes to 131,879 raw / 48,329
bytes. Production TypeScript changed from 18,190 to 18,203 lines. Three paired
baseline/current shared-tick medians were 1.663/1.685, 1.640/1.652 and
1.611/1.637 ms; predicted-with-capture medians were 1.891/1.886,
1.874/1.930 and 1.832/1.875 ms. These measurements are noisy, with no clear
sustained slowdown. The tuned speed of 60 is retained; expansion is not
simulated as a continuously moving shape between ticks.

## Shield generator accent (2026-09-25)

The generator's plus sign used the canvas default black stroke because its
parent renderer restores canvas state. It now explicitly strokes in the
module's violet accent and restores canvas state afterward. A source and
production rendering regression reproduced black before the change and passed
afterward. Shared/rendering tests, typecheck and build passed. The main chunk
is 131,944 raw / 48,351 gzip-level-1 bytes after this milestone, compared
with 131,879 / 48,329 after the contact milestone. No simulation code changed,
so the prior shared benchmark remains applicable.

## Remote searchlight item reveal (2026-09-25)

The buried-item reveal pass selected only the local player's lamp, although
all visible crafts already rendered their beams. The lighting renderer now
uses every visible, healthy craft's active beam, the same predicted craft
state and displayed pose used to render its beam, and the existing rock-slice
and beam masks. It reuses the prism traced in the preceding render layer.
The reveal code lives in the existing lighting module rather than adding a
production module. The source and production rendering regression covers a
remote lamp, beam clipping, remote displayed pose and predicted activation.

The full test suite, typecheck, lint, formatting check and production build
passed. The final main chunk is 132,311 raw / 48,486 gzip-level-1 bytes;
production TypeScript is 18,252 lines. Relative to the fresh pre-fix baseline
of 131,638 / 48,230 bytes and 18,190 lines, these three behavior fixes add
673 raw bytes, 256 gzip-level-1 bytes and 62 production lines. The docked and
sound chunks remain 5,631 and 1,691 raw bytes. Shared performance was measured
for the only solver change in the first milestone; the later two milestones
change client rendering only. Browser benchmarks remain excluded by the user's
instruction to use shared benchmarks only. A remaining visual risk is that
multiple overlapping beams may redraw the same buried item inside both masks;
its normal opaque item paint should look the same, but this was not measured
in a browser.

### Tick marker refinement (verified)

The first shield fix cleared expansion state on every craft segment every
world tick. It now stamps only a growing shield segment with the current
simulation tick. The collider uses the tuned surface speed only during that
tick, including its final expansion step. Collision, prediction, typecheck,
lint and build checks passed after this change. Five paired baseline/current
shared-tick medians were 1.628/1.639, 1.589/1.652, 1.647/1.657,
1.478/1.562 and 1.483/1.494 ms; the last two pairs reversed the run order.
The current build remains slightly slower in these measurements, but the gap
varies from 0.01 to 0.084 ms with large run-to-run changes in both builds.
The ordinary scenario has no expanding shield, so this is an upper bound on
incidental overhead rather than expansion cost. No browser benchmark was run,
per the user's instruction.

The solver was then adjusted so zero surface-speed contacts keep the ordinary
velocity-bias path. Three fresh paired baseline/current shared-tick medians
were 1.490/1.468, 1.492/1.482 and 1.470/1.472 ms; corresponding predicted
with capture medians were 1.712/1.692, 1.708/1.695 and 1.673/1.675 ms.
The earlier small gap did not persist after this change. The final full
test suite, typecheck, lint, formatting check and build passed.

## Mass, edges, and dead Planck artifacts inventory (2026-09-25)

Fresh implementation baseline: 132,311 raw / 48,486 gzip-level-1 bytes in
the main chunk, 129 transformed modules, and 18,252 production TypeScript
lines. The baseline build and typecheck passed.

| Candidate                                                                                             | Callers and current behavior                                                                                                                                                                                                                                                                      | Performance and bundle effect                                                                                                 | Proposed owner                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Solver.TimeStep = TimeStep` and its `@ts-ignore`                                                     | No reader; all consumers import `TimeStep` directly.                                                                                                                                                                                                                                              | One assignment in the initial chunk.                                                                                          | Remove.                                                                                                                      |
| Commented `validate()` calls in `dynamic-tree.ts` and `destroyFcn(contact)` in `collision-contact.ts` | No live function call or callback; they do nothing.                                                                                                                                                                                                                                               | Comments only.                                                                                                                | Remove.                                                                                                                      |
| Fixture `density`, shape `computeMass`, `MassData`, and body `resetMassData`                          | Fixture creation/destruction invokes shape area, centroid, and second-moment integration. `GameCollisions` immediately overrides the body mass with `entity.mass`, retaining only normalized rotational inertia; CCD and contact solvers consume inverse mass, inverse inertia, and sweep center. | Geometry rebuild path, not each tick; sizeable first-frame code.                                                              | Game collision adapter owns direct mass/inertia transfer; exact inertia versus simpler approximation awaits gameplay choice. |
| `GameObject.mass` default 0 and explicit game mass                                                    | Bare generic objects are kinematic; ship 9, item 6, station 900, asteroid `0.4 * radius ** 2`, and wreckage segment count are already set by game code. Mass is sent on the wire and affects thrust, impulse, damage, fragmentation, and prediction.                                              | Body type and collision behavior can change if the default changes.                                                           | Game object hierarchy; default choice awaits gameplay guidance.                                                              |
| `outerEdges` versus asteroid/craft boundary code and Planck polygon contact edge data                 | The game-owned `outerEdges` marks exterior edges and groups connected pieces for craft breakage and asteroid splitting. Asteroid boundary traversal consumes those marks. Planck polygon contact feature indices instead identify manifold edges.                                                 | Boundary work happens on shape creation/damage and affects fracture/rendering; contact feature indices are in the hot solver. | Keep the shared game `outerEdges` utility; no duplicate behavior is present.                                                 |

### Dead artifact removal (verified)

Removed the unused `Solver.TimeStep` property assignment and its `@ts-ignore`,
two commented tree-validation calls, and the commented contact-destruction
callback. Direct `TimeStep` imports remain the only callers. Collision tests,
typecheck, lint, formatting and production build passed. The main chunk fell
from 132,311 / 48,486 to 132,292 / 48,472 bytes (raw / gzip-level-1);
production TypeScript fell from 18,252 to 18,243 lines. This changes no tick
work, so no new simulation benchmark is needed. No `@ts-ignore` remains under
`src/shared`.

A second search found commented-out manifold ID assignments, solver state
resets, and older vector-method calls. Removed these too, along with the
adjacent `// why?`; retained the equations that explain the block solver.
No source `@ts-ignore` or `@ts-expect-error` remains. Lint and formatting
passed. This comment-only pass takes production TypeScript from 18,243 to
18,224 lines and leaves the built JavaScript unchanged.

The repository-wide check found one more commented-out `roads.forEach` in
the client render loop; it was removed. No source `@ts-ignore`,
`@ts-expect-error`, or line comment ending as a JavaScript statement remains.
Lint and formatting passed. Production TypeScript is now 18,223 lines, with
no JavaScript change from this comment-only removal.

For the pending mass decision, a temporary comparison evaluated 500 circles
and 500 polygons (including offsets) against the current shape integration.
The direct shoelace second-moment formula matched with worst relative error
3.4e-14. This supports removing fixture-density integration while retaining
current angular response. Three baseline shared-tick medians from the frozen
current source were 1.488, 1.498 and 1.486 ms; predicted-with-capture medians
were 1.717, 1.699 and 1.687 ms.

## Two-player asteroid source resurrection (2026-09-25)

A deterministic two-player reproduction exposed the actual duplicate. When two
regional views included one procedural asteroid, the first view removed its
source after a fracture, but the second view still held the old description
from the same `queryMany` result. It recreated the parent at exactly its old
position alongside the fragments. In the next physics tick that overlapping
parent fractured again, leaving persistent duplicate large descendants. The
initial overlap between different generated asteroids was a separate finding,
not this bug.

Server regional sync now processes each procedural ID once per call, for
asteroids, stations and wrecks. The new regression failed before the fix and
passes after it with both players in range. The exact reproduction now retains
only the intended fragments; `test:regions`, `test:server`, `test:simulation`,
typecheck/build, lint and formatting all pass. The main chunk remains 132,292
raw / 48,472 gzip-level-1 bytes, with 129 transformed modules. Production
TypeScript is 18,226 lines, three more than the pre-fix 18,223 lines. Three
sequential shared-tick medians were 1.498, 1.485 and 1.493 ms, versus the
fresh pre-fix 1.488, 1.498 and 1.486 ms. Predicted-with-capture medians were
1.714, 1.719 and 1.718 ms, versus 1.717, 1.699 and 1.687 ms. The change is
server-only and outside those benchmark paths; the small variation is within
run-to-run noise. No sustained slowdown is evident.

A separate generation rule still needs restoring: the pre-network `distribute`
helper rejected new asteroids if an already placed object was closer than the
sum of radii plus a 30-metre density gap. Regional generation currently has no
such check, so different asteroids can start interpenetrating. The user asked
to restore generation-time spacing, not to relocate already generated rocks.

## Procedural asteroid spacing: baseline and inventory (2026-09-25)

The pre-network `src/distribute.ts` checked each candidate against objects
already placed using `candidate.distanceTo(other.position) < candidate.radius +
other.radius + density` and omitted the candidate when it was too close.
`src/world.ts` passed `density: 30` for asteroid fields and included stations,
wrecks and preceding asteroids in that check. The regional generator replaced
this with independent random positions and has no proximity check. Its callers
are shared/server region queries, server materialisation, tests and the world
preview; client snapshots carry final world positions. This is a region-load
path, not a per-tick collision path. The server remains the placement owner.

Current seed 25 has 55 overlapping asteroid pairs among 481 rocks within 10 km
of the starting station. A deeply overlapping pair has centres 74 m apart and
radii 78 m and 123 m. A separate two-player regional sync bug caused the exact
same asteroid to be resurrected; that bug is fixed above. The spacing
milestone will reject new procedural candidates that violate the old 30 m gap,
using a stable cross-region priority so loading order cannot change results.
It will keep retained asteroid IDs, positions and material values; it will not
move an already generated asteroid or alter mining/fracture code.

Fresh baseline after the sync fix: 132,292 raw / 48,472 gzip-level-1 bytes in
the main chunk, 18,226 production TypeScript lines. Twenty warmed fresh
121-region queries at world seed 25 had median 1.192 ms and p90 1.624 ms.
The three shared-tick medians immediately before this milestone were 1.498,
1.485 and 1.493 ms. Remaining risks are changed generated world membership
and possible region-load latency; both will be measured after implementation.

### Generation spacing restored (verified)

The regional generator now forms deterministic raw candidates, then rejects
asteroids that fall within another eligible asteroid or a station/wreck by less
than the sum of radii plus `asteroidSpacing = 30`. A lower stable entity ID
wins each asteroid conflict, so two adjacent regions make the same decision
regardless of which loads first. Rejected rocks are omitted, matching the old
`distribute` behavior; no asteroid is moved, and retained descriptions keep
their original IDs and positions. The server's source-resurrection fix and
fracture behavior are unchanged.

The spacing regression failed on seed-25 overlapping rocks before the change
and now passes across a nine-region grid. A 10 km query around the starting
station changed from 481 rocks with 55 overlapping pairs to 402 rocks with
zero overlapping pairs. The full test suite, typecheck, lint, formatting and
production build passed. The main chunk stays 132,292 raw / 48,472
gzip-level-1 bytes and 129 modules; production TypeScript is 18,273 lines,
47 more than the spacing baseline because regional separation needs a new
candidate pass. The sound and docked chunks remain unchanged.

Twenty warmed fresh 121-region queries increased from median 1.192 ms / p90
1.624 ms to median 6.997 ms / p90 9.573 ms. This is first-load generation
work; already loaded regions do not regenerate on each tick. Three sequential
shared-tick medians were 1.162, 1.174 and 1.174 ms, and predicted-with-capture
medians were 1.412, 1.389 and 1.371 ms. Their scenario now contains 37
entities instead of 43 because crowded candidates are omitted, so those
figures are not a like-for-like solver speedup. No simulation or solver code
changed in this milestone. The measured cold-load cost is the remaining
performance risk; it is below 10 ms for a fresh 121-region query on this
machine and is not incurred every simulation tick.

## Search-light wreckage housing (2026-09-25)

Inventory before editing: the search light has one live beam segment whose
points span roughly 400 metres when active and are empty when inactive.
`Craft.detach` was the only path that converted those points into detached
wreckage, so an active light left a beam-sized polygon behind. The cargo hatch
already uses a 16-by-3 door; its existing wreckage path and the client's
`renderWreckage` path are the geometry and presentation references. Network
wreckage snapshots carry the final outline and fill shade, so no protocol
change is needed. Detachment is event-driven, outside the per-tick solver.

The search light now supplies its own 8-by-3 lamp-housing outline, beginning
at its lens, and uses shade index 2 from the same module palette. `Craft.detach`
uses custom wreckage points and preserves an explicit fill shade when supplied;
other modules retain their existing points and damage-based shade. The live
beam and cargo hatch are unchanged. Regression coverage failed before the fix
and now passes for both inactive and active lights, including reconstruction
from network wreckage data. The full test suite, typecheck, lint, formatting
check and production build passed.

Fresh pre-change main chunk: 132,292 raw / 48,472 build-reported compressed
bytes; post-change: 132,408 raw / 48,527 compressed bytes, both with 129
transformed modules. Production TypeScript changed from 18,273 to 18,285
lines. Three shared-tick medians after the change were 1.170, 1.175 and 1.182
ms, compared with the previous same-scenario 1.162, 1.174 and 1.174 ms;
three predicted-with-capture medians were 1.375, 1.386 and 1.388 ms, compared
with 1.412, 1.389 and 1.371 ms. These shifts are within run-to-run variation,
and the changed detach path is not used by the benchmark's steady-state ticks.
Browser benchmarks remain excluded by the user's choice to use shared
benchmarks only. There is no remaining behavior risk identified for this
module; the small chunk increase reflects the new explicit wreckage model.

## Shared settings location: baseline and inventory (2026-09-25)

The current `src/shared/physics-settings.ts` owns `linearSlop` (used by five
collision and solver modules) and `contactSpeedThreshold` (used by contact
response and game collision events). They are the two physics settings to
move to `src/shared/setting.ts`, under `// Physics Settings`.

The shared-code audit found four more cross-module settings: `simulationStep`
(the tick duration used by shared simulation, client prediction and server),
`updateTiers` (shared update scheduling and client interpolation), `regionSize`
(region generation and lookup), and `worldRanges` (default regional view ranges
used by the shared and server region managers). The new general settings file
will own these too, grouped by simulation and regions. Direct consumers and
test imports will move to that owner; the simulation barrel will keep its
existing public region exports. Values and behavior will remain the same.

Other candidates are single-file production concerns and will stay with their
owners: `asteroidSpacing` and `asteroidVariance` in asteroid generation,
solver translation/rotation and TOI limits in the solver, AABB expansion in
the tree, drag in movement, and craft/module dimensions and materials in their
respective files. `serverRanges` is only used by the server region manager.
The tests read `asteroidSpacing`, but that does not make it a cross-module
production setting. The repeated 2000 values represent distinct region,
observation, and loading distances; equal values do not make them one setting.

Fresh baseline on this machine: production build and typecheck passed; 129
transformed modules; main chunk 132,408 raw / 48,527 build-reported compressed
bytes; 18,285 production TypeScript lines. Three shared-tick medians were
1.174, 1.186 and 1.175 ms, and predicted-with-capture medians were 1.409,
1.410 and 1.402 ms, for 37 entities. This relocation has no allocation or
algorithm change; a repeated benchmark after editing will check for an
unexpected sustained slowdown.

### Shared settings relocated (verified)

`src/shared/setting.ts` now owns the two collision tolerances under the exact
`// Physics Settings` heading, plus `simulationStep`, `updateTiers`, `regionSize`
and `worldRanges` under simulation and region headings. `physics-settings.ts`
is removed. Shared, client, server and test consumers import from the new
owner; the simulation barrel still exports the public region settings.
`moduleControls` stays in ship control because its module-to-input mapping is
behavior, and `cargoHatchOpen` stays with the hatch geometry it derives from.
No values, collision rules, network data, or scheduling logic changed.

The full test suite, typecheck, lint, formatting check and production build
passed. The production build still transforms 129 modules. Main chunk raw size
remains 132,408 bytes; build-reported compressed size changed from 48,527 to
48,576 bytes, a 49-byte change due to bundling order. Production TypeScript
changed from 18,285 to 18,287 lines. Three after-change shared-tick medians
were 1.191, 1.166 and 1.177 ms versus 1.174, 1.186 and 1.175 ms before;
predicted-with-capture medians were 1.405, 1.405 and 1.401 ms versus 1.409,
1.410 and 1.402 ms. No sustained performance change is evident, as expected
for a constant relocation. Browser measurements remain excluded by the user's
choice to use shared benchmarks only. No remaining behavior risk identified.

## Explicit mass and rotational inertia: baseline and inventory (2026-09-25)

The user confirmed two gameplay choices: bare `GameObject.mass` remains 0,
which keeps generic objects kinematic, and asteroids retain their explicit
`0.4 * radius ** 2` rule so splitting and collision weights stay stable.
Ship, item, station and wreckage masses are already assigned by game code;
fixture density is not their source.

The reachable physics mass path is `GameCollisions.sync` → fixture creation
with density 1 for physical colliders and 0 for nonphysical colliders →
`Body.resetMassData` → shape `computeMass` → `Body.getMass`/`getInertia` →
`Body.setMassData`. The last call immediately replaces integrated mass with
`entity.mass` and resets the body center to its origin. The only retained
quantity is shape second moment divided by shape area, scaled by explicit
object mass and `angularInertiaScale`. CCD and contact solvers read `m_invMass`,
`m_invI`, and the sweep center; there are no other `getMass`, `getInertia`,
`setMassData`, `resetMassData`, density, or `MassData` callers. Nonphysical
colliders must continue to contribute no spin inertia. Fixture creation and
geometry rebuild are the performance-sensitive paths; this code is not run
for unchanged geometry every tick. The density/shape integration machinery
has substantial bundle and source-line cost, so `GameCollisions` will own a
small direct second-moment calculation over finalized circle/polygon shapes
and pass explicit mass and inertia to the body. Sweep local center remains
zero, as it already does after `setMassData`.

Fresh baseline: build/typecheck passed, 129 transformed modules, main chunk
132,408 raw / 48,576 build-reported compressed bytes, 18,286 production
TypeScript lines. Three shared-tick medians were 1.184, 1.183 and 1.178 ms;
predicted-with-capture medians were 1.393, 1.395 and 1.396 ms (37 entities).
A regression for explicit mass 10, two physical offset circles, a large
nonphysical circle and `angularInertiaScale = 3` passes against the existing
engine: inverse mass 0.1 and inverse inertia 1/267. Existing off-center impact,
ship spin, CCD and rollback tests provide gameplay coverage. After editing,
the same tests and repeated benchmarks will check equivalence.

### Explicit mass refactor (verified)

The body now receives the game object's explicit mass and inverse inertia.
`GameCollisions` calculates only the area-normalized second moment of its
finalized physical circles and polygons, then multiplies that spin factor by
`entity.mass` and `angularInertiaScale`. Nonphysical triggers contribute
neither area nor spin resistance. This keeps the object's origin as the sweep
center and preserves the previous off-center collision response without
fixture density, `MassData`, shape `computeMass`, body mass resetting, or
`getMass`/`getInertia` APIs. Changing an existing entity from positive mass to
0 now recreates its body as kinematic. `GameObject.mass` remains 0; the
existing explicit ship, item, station, wreckage and asteroid mass assignments
remain unchanged.

The regression checks circle and polygon inertia, multiple physical circles,
a large nonphysical trigger, `angularInertiaScale`, and a dynamic-to-kinematic
mass change. The full test suite (including CCD, shield bounce, asteroid
splitting, rollback and client/server prediction), typecheck, lint,
formatting and production build all passed. Three extra standalone prediction
runs passed; two had zero corrections and one had a small 0.049-unit worst
correction. The full-suite run reported 0.004-unit worst correction, indicating
timing variation rather than a failed collision invariant.

Main chunk: 132,408 → 130,423 raw bytes and 48,576 → 47,925 build-reported
compressed bytes, with 129 transformed modules. Production TypeScript:
18,286 → 17,995 lines. Three after-change shared-tick medians were 1.183,
1.174 and 1.182 ms versus baseline 1.184, 1.183 and 1.178 ms;
predicted-with-capture medians were 1.386, 1.386 and 1.387 ms versus 1.393,
1.395 and 1.396 ms. No sustained performance regression is evident. The
remaining numerical risk is negligible roundoff for unusual distant local
polygon coordinates; the game uses local collider geometry and prior
1,000-shape comparisons found worst relative difference 3.4e-14. Browser
measurements remain excluded by the user's choice to use shared benchmarks.

## Unused legacy distribution helper: inventory (2026-09-25)

`src/shared/utilities/distribute.ts` is the old round-object placement helper.
A repository-wide search found no imports or callers in production, tests, or
benchmarks. Its `density` parameter means an extra spacing gap, not physical
mass density. Current deterministic regional placement and the 30-metre
asteroid gap are owned by `simulation/region-generation.ts`; removing this
unreachable helper changes neither placement nor any runtime path. It adds no
bundle bytes because the build excludes it, but costs 43 production TypeScript
lines. The fresh baseline is the verified mass build above: 130,423 raw /
47,925 compressed main-chunk bytes, 17,995 production TypeScript lines.

### Legacy distribution helper removed (verified)

Deleted the unreferenced helper. The full test suite, typecheck, lint,
formatting and production build passed. The main chunk remains 130,423 raw /
47,925 compressed bytes and 129 transformed modules, confirming it was not
bundled. Production TypeScript fell from 17,995 to 17,952 lines. No runtime
benchmark was needed for an unreachable file; the mass milestone's repeated
shared measurements remain the performance result.

## Mustang defaults: inventory (2026-09-25)

`Mustang` defines `static mass = 9` and `static radius = 40`, while its sole
factory `createShip` repeats both values in constructor properties. The
`GameObject` constructor copies subclass defaults before per-instance
properties, so removing the two factory copies preserves the values and gives
the ship class one owner for them. All client/server/simulation ship creation
uses this factory; direct `new Mustang` also uses the class defaults. The
factory runs at spawn, outside steady-state simulation. Fresh baseline is the
previous verified build: 130,423 raw / 47,925 compressed main-chunk bytes and
17,952 production TypeScript lines. The shared benchmark is unaffected by
this construction-only duplicate.

### Mustang defaults consolidated (verified)

Removed the factory's repeated mass 9 and radius 40. The class defaults remain
the only source for these values. The full test suite, typecheck, lint,
formatting and production build passed. Main chunk changed from 130,423 to
130,406 raw bytes and 47,925 to 47,910 compressed bytes; transformed modules
remain 129. Production TypeScript changed from 17,952 to 17,950 lines. This
spawn-only cleanup has no steady-state benchmark path, so the preceding mass
milestone's repeated shared measurements apply. No remaining behavior risk
identified.

## Game object typing and shared settings: baseline and inventory (2026-09-25)

`GameObjectLike` is a permissive structural type in `shared/types.ts` with an
`any` index signature and only position, velocity, radius and rotation
required. Its actual sprite collections in client game state, main,
lighting, debug and prism contain decorated `GameObject` subclasses from the
shared simulation. `damage` receives an actual `GameObject`, a craft `Segment`,
or an `AsteroidSegment`. Camera follow and beam tracing also accept small
pose objects, so those parameters need only selected `GameObject` fields or
an explicit pose shape. No caller constructs a separate `GameObjectLike`
runtime object. The type can be deleted, with actual `GameObject` used for
objects and narrow pose shapes retained where needed. These are type-only
changes with no production bundle or runtime allocation impact.

`shared/setting.ts` owns the 30 Hz `simulationStep` and `updateTiers`; the
two tier entries already encode 60 Hz visible movement, 15 Hz distant
movement, 30 Hz visible replication and 7.5 Hz distant replication. The
nearby/distant boundary is currently a 2000-unit literal in `updateTier`,
so `settings.ts` will own that value beside the tier schedule. The server's
entity and marker load/unload distances are separate one-file replication
settings, and the client's active sprite radius is a one-file render setting;
they remain with their owners. All `setting.ts` consumers across shared,
client, server and tests will import `settings.ts`. Short inline comments
will describe the units/rates next to their values instead of the current
three-line prose comment. Values and behavior remain unchanged.

Fresh baseline: typecheck/build passed, 129 transformed modules, main chunk
130,406 raw / 47,910 build-reported compressed bytes, 17,950 production
TypeScript lines. Three shared-tick medians were 1.173, 1.166 and 1.341 ms;
predicted-with-capture medians were 1.422, 1.534 and 1.529 ms. The third
run was slower across all measures on this machine, so post-change timings
must be judged against the spread, not one run. No collision algorithm changes.

### Game object typing and settings rename (verified)

Removed `GameObjectLike` from shared types. Sprite collections and damage
accept actual `GameObject` instances; camera and prism keep narrow pose
parameters because those callers also pass position/rotation views. Renamed
`shared/setting.ts` to `shared/settings.ts` and updated all shared, client,
server and test imports. `visibleRange = 2000` now sits beside
`simulationStep` and `updateTiers`; short inline comments give the 30 Hz tick,
60/15 Hz movement and 30/7.5 Hz replication rates. Server-only load/unload
ranges and client-only sprite culling remain beside their sole callers.

The full test suite, typecheck, lint, formatting check and production build
passed. The main chunk is byte-for-byte unchanged at 130,406 raw / 47,910
build-reported compressed bytes, with the same 129 transformed modules.
Production TypeScript fell from 17,950 to 17,933 lines. Three after-change
shared-tick medians were 1.299, 1.287 and 1.298 ms, and predicted-with-capture
medians were 1.539, 1.540 and 1.521 ms; the baseline's last run was already
1.341 / 1.529 ms. To distinguish machine load from a tier-boundary cost, two
paired unminified benchmarks temporarily substituted the original `2000`
literal: inline runs measured 1.287/1.291 ms per shared tick and 1.523/1.523
ms with capture; restored named-range runs measured 1.291/1.283 ms and
1.524/1.531 ms. The runtime code path and production chunk are equivalent,
with no sustained performance difference attributable to this edit. Browser
benchmarks remain excluded by the user's choice. No remaining behavior risk
identified.

## Dead vector and physics API audit: baseline and inventory (2026-09-25)

The shared Vector and all collision, common-physics, and dynamics declarations
were scanned against production, tests, and benchmarks, then low-reference
methods were checked at their call sites. The following have no callers:

| Candidate                                       | Callers and behavior                                 | Performance / bundle impact                   | Replacement or deletion reason                                           |
| ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `Vec2.isValid`                                  | None; validates finite x/y for a Planck-style vector | Dead type guard; likely tree-shaken           | Delete; no production input validation reaches it.                       |
| `Vec2.lengthSquared`                            | None; delegates to `physics-matrix.lengthSqrVec2`    | Dead wrapper; likely tree-shaken              | Delete; out-parameter solver helper remains the owner of squared length. |
| `Body.isKinematic` and its `KINEMATIC` constant | None; checks the body-type string                    | Dead method and constant                      | Delete; dynamic/kinematic behavior still uses `isDynamic` and `m_type`.  |
| `physics-matrix.addVec2`                        | None; writes two input vectors into an output vector | Dead out-parameter helper; likely tree-shaken | Delete; live `plusVec2` and `subVec2` remain.                            |

Other low-reference methods were retained after checking use: polygon hull
construction calls `normalizeSelf`; `getContactList` is used by world contact
creation; fixture, broadphase, GJK, TOI and solver methods each have live
callers. Vector `set`, `zero`, `neo`, `clone`, `mul`, `dot`, `distanceTo` and
normalization methods also have live game or solver callers. This pass removes
unused surface area only; it does not change numerical behavior or hot loops.

Fresh baseline build/typecheck passed: 129 transformed modules, 130,406 raw /
47,910 build-reported compressed bytes in the main chunk, 17,933 production
TypeScript lines. Three shared-tick medians were 1.288, 1.288 and 1.292 ms;
predicted-with-capture medians were 1.526, 1.515 and 1.514 ms (37 entities).

### Dead vector and physics APIs removed (verified)

Removed the four no-caller APIs listed above and the `KINEMATIC` constant
used only by the dead method. `Vec2` no longer imports squared-length math
solely for its unused wrapper. A second declaration scan found no remaining
vector/collision/physics method name that appears only at its declaration;
the strict TypeScript unused-locals/parameters check also passed.

The full test suite (including collision CCD, shield bounce, asteroid
splitting, prediction and rollback), typecheck, lint, formatting, strict
unused-symbol check and production build passed. The main chunk fell from
130,406 to 130,229 raw bytes and from 47,910 to 47,866 build-reported
compressed bytes, with 129 transformed modules. Production TypeScript fell
from 17,933 to 17,909 lines. Three after-change shared-tick medians were
1.298, 1.316 and 1.292 ms versus 1.288, 1.288 and 1.292 ms before;
predicted-with-capture medians were 1.522, 1.511 and 1.524 ms versus 1.526,
1.515 and 1.514 ms. These changes are within run-to-run variation and no hot
call site changed. Browser measurements remain excluded by the user's choice.
No remaining behavior risk identified for these removals.

## Simulation state files: baseline and inventory (2026-09-25)

`shared/serializer` contains only `simulation-entity-state.ts` and
`simulation-world-state.ts`. `EntityState` captures mutable fields and retained
object identities for rollback; `captureWorld` and `restoreWorld` use it to
checkpoint a `SimulationWorld`. The world-state file also owns `cloneEntity`,
which makes independent simulation objects for prediction. Callers are shared
simulation exports, client prediction and frame prediction, rollback and
collision tests, and the shared benchmark. These functions copy in-memory
mechanics; they do not encode network messages or persistent data. The network
snapshot is separately defined and produced under `protocol` and server
replication. Thus `simulation` is their actual owner and the filename prefix
is redundant there.

Move the files to `shared/simulation/entity-state.ts` and
`shared/simulation/world-state.ts`, preserving exports and behavior. Update
all production, test, benchmark and barrel imports. The now-empty serializer
folder can disappear. The terminology document will define `simulation` as
the shared world mechanics run by the server and used for client prediction,
and `simulation state` as an in-memory checkpoint for rollback, distinct from
its existing network `snapshot` definition. Capture/restore and cloning are
performance-sensitive on prediction and rollback paths, but the move changes
no algorithm, allocation or wire format.

Fresh baseline: typecheck/build passed, 129 transformed modules, main chunk
130,229 raw / 47,866 build-reported compressed bytes and 17,909 production
TypeScript lines. Three shared-tick medians were 1.292, 1.281 and 1.328 ms;
rollback-capture medians 0.182, 0.182 and 0.189 ms; predicted-with-capture
medians 1.528, 1.501 and 1.536 ms (37 entities). Existing snapshot,
client/server prediction, collision rollback and shared-object tests protect
the move.

### Simulation state files moved (verified)

Moved the two files to `shared/simulation/entity-state.ts` and
`shared/simulation/world-state.ts`, updated all production and test imports,
and removed the empty `serializer` folder. Public `EntityState`,
`SimulationWorldState`, `cloneEntity`, `captureWorld` and `restoreWorld`
exports remain available. `docs/terminology.md` now defines `simulation` and
`simulation state`; the existing `snapshot` definition continues to mean a
server-to-client network update.

The full test suite, typecheck, lint, formatting and production build passed.
The main chunk is byte-for-byte identical at 130,229 raw / 47,866
build-reported compressed bytes and 129 transformed modules. Production
TypeScript remains 17,909 lines. Three post-move shared-tick medians were
1.366, 1.366 and 1.294 ms versus 1.292, 1.281 and 1.328 ms before;
rollback-capture medians were 0.191, 0.198 and 0.175 ms versus 0.182, 0.182
and 0.189 ms; predicted-with-capture medians were 1.594, 1.540 and 1.532 ms
versus 1.528, 1.501 and 1.536 ms. Run-to-run machine load varied, while the
production runtime output and checkpoint algorithms are identical. No
sustained regression is attributable to the move. Browser benchmarks remain
excluded by the user's choice. No data-format or behavior risk remains.

## Index-file inventory and baseline (2026-09-25)

The five `src/**/index.ts` files have distinct roles. `server/index.ts` is the
server executable entry point and must stay. `items/index.ts` defines the
`itemTypes` catalog and `modules/index.ts` defines `moduleTypes` and
`thrusters`; these catalogs group related gameplay objects and have live
callers, so they stay. `simulation/index.ts` only re-exports unrelated
simulation, craft, item, settings and random modules. No production module
imports it; three virtual entry points in the collision test, simulation test
and shared benchmark use it to select exports. Their replacement is direct
exports from the actual owner files. `protocol/index.ts` only re-exports
protocol definitions and has no callers anywhere in production, tests or
benchmarks, so it can be deleted without a replacement. Both removable files
have no production bundle impact. The simulation test and benchmark entry
points are test/runtime-sensitive; preserving their exact consumed exports
avoids behavior or benchmark changes.

Fresh baseline: typecheck/build passed; 129 transformed modules, main chunk
130,229 raw / 47,866 build-reported compressed bytes, 17,909 production
TypeScript lines. Three shared-tick medians were 1.310, 1.287 and 1.325 ms;
rollback-capture medians 0.209, 0.224 and 0.174 ms; predicted-with-capture
medians 1.529, 1.553 and 1.589 ms, each with 37 entities. The index removal
should leave the output chunk and shared benchmark behavior unchanged while
removing 40 source lines.

### Index barrels removed (verified)

The collision and simulation test entry points and shared benchmark now export
only their consumed functions from the owning files. Deleted the unused
`simulation/index.ts` and `protocol/index.ts` barrels (40 production TypeScript
lines). Kept the server entry point and the item and module catalogs. The full
test suite, typecheck, lint, formatting and production build passed. The
production chunk is byte-for-byte unchanged at 130,229 raw / 47,866
build-reported compressed bytes, with 129 transformed modules. Production
TypeScript decreased from 17,909 to 17,869 lines. Three post-change
shared-tick medians were 1.291, 1.290 and 1.288 ms versus 1.310, 1.287 and
1.325 ms before; rollback-capture medians were 0.175, 0.178 and 0.176 ms
versus 0.209, 0.224 and 0.174 ms; predicted-with-capture medians were 1.516,
1.518 and 1.532 ms versus 1.529, 1.553 and 1.589 ms. All measured changes
are within or better than baseline variation. No allocation or behavior path
changed; no remaining risk identified for this removal. Browser benchmarks
remain excluded by the user's choice.

## Starter-module helper inventory and baseline (2026-09-25)

`fitStarterModules.ts` has exactly two callers: client `player.ts` fits the
initial local rendered ship, and shared `create-ship.ts` fits server-created
and predicted ships. It creates one medium dual thruster, two cargo hatches,
one horn drill and one search light, in that order. Both callers need the same
behavior; neither needs a separate abstraction for this fixed five-module
sequence. Replace each call with the same sequence at its call site, retaining
module order and instances, then delete the helper. Ship construction and
client prediction depend on these layouts; tests for shared objects, snapshots,
server prediction, and docked cargo cover them. This setup runs when a ship is
created, outside the per-tick hot path. The helper is bundled in the main
chunk; its removal may change the minified size slightly.

Fresh baseline: typecheck/build passed, 129 transformed modules, main chunk
130,229 raw / 47,866 build-reported compressed bytes and 17,869 production
TypeScript lines. Three shared-tick medians were 1.296, 1.315 and 1.295 ms;
rollback-capture medians 0.179, 0.181 and 0.180 ms; predicted-with-capture
medians 1.528, 1.527 and 1.516 ms, each with 37 entities.

### Starter-module helper inlined (verified)

Inlined the five starter module constructors at the two ship setup sites and
removed `fit-starter-modules.ts`. The order and number of module instances are
unchanged. The full test suite, typecheck, lint, formatting and production
build passed after formatting the new imports. Build transformed 128 modules
instead of 129. The main chunk changed from 130,229 raw / 47,866 compressed
bytes to 130,247 raw / 47,876 compressed bytes; repeating the short setup
sequence costs 18 raw and 10 compressed bytes. Production TypeScript changed
from 17,869 to 17,870 lines. Three post-change shared-tick medians were 1.291,
1.282 and 1.283 ms versus 1.296, 1.315 and 1.295 ms before;
rollback-capture medians were 0.180, 0.178 and 0.181 ms versus 0.179, 0.181
and 0.180 ms; predicted-with-capture medians were 1.522, 1.528 and 1.535 ms
versus 1.528, 1.527 and 1.516 ms. These are within baseline variation; no
allocation or per-tick algorithm changed. The small size increase is the
cost of the requested direct setup at both callers, with no material effect
on the overall code-size goal. Browser benchmarks remain excluded by the
user's choice.

## Item factory inventory and baseline (2026-09-25)

`create-item.ts` has three production callers: client network reconstruction,
server wreck cargo creation, and asteroid loot spawning. Tests call it from
prediction, simulation, and collision cases; the shared benchmark reaches it
through world setup. The helper selects `itemTypes[resource]`, forwards world,
resource, position and velocity, and assigns `entityId(world)` when no ID is
supplied. It has no validation or item-specific behavior. Its replacement is a
direct `new itemTypes[resource]` at runtime resource-selection sites and a
direct `new Diamond` in tests with literal resource 0. Callers without an ID
must retain `entityId(world)` so world ID sequencing, deterministic random
seeding, network snapshots and prediction stay the same. `GameObject` already
supplies fresh zero vectors when position or velocity is absent, and item
classes already supply their own resource number. This constructor work runs
on spawn/reconstruction, not each physics tick; asteroid loot and network
reconstruction are burst-sensitive but there is no new per-item loop. The
helper is bundled in the main chunk and its removal may affect chunk size.

Fresh baseline: typecheck/build passed, 128 transformed modules, main chunk
130,247 raw / 47,876 build-reported compressed bytes and 17,870 production
TypeScript lines. Three shared-tick medians were 1.293, 1.294 and 1.286 ms;
rollback-capture medians were 0.176, 0.175 and 0.180 ms; predicted-with-capture
medians were 1.529, 1.528 and 1.532 ms, each with 37 entities.

### Item factory inlined (verified)

Removed `create-item.ts` and all its references. Runtime resource IDs now
select `itemTypes[resource]` at network reconstruction, wreck cargo creation,
and asteroid loot spawning. Tests with a known resource construct `Diamond`
directly. Callers that previously omitted IDs still use `entityId(world)`;
position and velocity fall back to fresh vectors in `GameObject`, and each
item class supplies its own matching resource number. Constructor and world
ID ordering are preserved.

The full test suite, typecheck, lint, formatting and production build passed.
Build transformed 127 modules instead of 128. The main chunk decreased from
130,247 raw / 47,876 compressed bytes to 130,142 raw / 47,861 compressed
bytes; production TypeScript decreased from 17,870 to 17,850 lines. Three
post-change shared-tick medians were 1.291, 1.287 and 1.281 ms versus 1.293,
1.294 and 1.286 ms before; rollback-capture medians were 0.175, 0.181 and
0.176 ms versus 0.176, 0.175 and 0.180 ms; predicted-with-capture medians
were 1.534, 1.528 and 1.511 ms versus 1.529, 1.528 and 1.532 ms. No
sustained regression or new per-tick allocation is evident. Browser
benchmarks remain excluded by the user's choice. No remaining behavior risk
identified for this removal.

## Cargo hatch contact helper inventory and baseline (2026-09-25)

`cargo-hatch-contact.ts` owns a symmetric filter that permits only cargo-mouth
versus item-centre trigger pairs, and a zero-radius nonphysical pickup-point
collider. `Item.hitbox()` creates the pickup point; `Craft.hitbox()` attaches
the filter to cargo mouths; `CargoHatch.collect()` checks the same rule before
collection. The collision pipeline invokes the filter on contacts and retains
the zero-radius point for swept crossings. Tests cover fast crossings, mouth
filtering, and item collection. The helper has no independent role: move both
exports into `cargo-hatch.ts` and update those two imports. `CargoHatch.collect`
currently determines the opposite collider twice; compute it once without
changing contact selection or collection checks. Keep the filter and trigger
properties identical. This adds a runtime Item-to-CargoHatch import cycle;
the functions and `instanceof Item` are used only after module initialization,
but test module loading in both client/server and direct test entry points.
The filter is contact-path sensitive; the move should change neither its
algorithm nor allocations. Removing a source module may affect build size.

Fresh baseline: typecheck/build passed, 127 transformed modules, main chunk
130,142 raw / 47,861 build-reported compressed bytes, 17,850 production
TypeScript lines. Three shared-tick medians were 1.287, 1.295 and 1.284 ms;
rollback-capture medians were 0.175, 0.175 and 0.176 ms; predicted-with-capture
medians were 1.503, 1.513 and 1.529 ms, each with 37 entities.

### Cargo hatch contact helper moved (verified)

Moved `cargoContactAllowed` and `cargoPickupPoint` into `cargo-hatch.ts`,
updated `Item` and `Craft` imports, and removed the separate
`cargo-hatch-contact.ts` file. `CargoHatch.collect` now identifies the
opposite collider once. The symmetric contact filter, zero-radius
nonphysical centre trigger, friction field, and all collection guards are
unchanged. The full test suite, typecheck, lint, formatting and production
build passed, including swept pickup, filtering, client/server prediction,
and cargo tests. The Item-to-CargoHatch import cycle loads correctly in those
entry points.

Build transformed 126 modules instead of 127. The main chunk decreased from
130,142 raw / 47,861 compressed bytes to 130,136 raw / 47,861 compressed
bytes; production TypeScript decreased from 17,850 to 17,849 lines. Three
post-change shared-tick medians were 1.302, 1.288 and 1.285 ms versus 1.287,
1.295 and 1.284 ms before; rollback-capture medians were 0.174, 0.181 and
0.177 ms versus 0.175, 0.175 and 0.176 ms; predicted-with-capture medians
were 1.496, 1.522 and 1.514 ms versus 1.503, 1.513 and 1.529 ms. The
variation shows no sustained regression. No per-contact allocation or
algorithm changed. Browser benchmarks remain excluded by the user's choice.

## Thruster base-class inventory and baseline (2026-09-25)

`shared/modules/thruster.ts` defines only `shades = colors.violet` and
`disablePhysics = true`. Four concrete thrusters inherit both. `Craft.hitbox`
and damage handling read `disablePhysics`; module and segment rendering,
painting, and docked-module tests use `shades`. The client flare renderer is
currently registered once on the base `Thruster` class, and the rendering test
uses `instanceof Thruster` to find nozzles. The existing `thrusters` catalog in
`shared/modules/index.ts` can register the renderer on all four concrete
classes and identify them in that test. Put the two defaults explicitly on
each concrete class and remove the shared base class.

`Ship.fly`, thrust getters and launch behavior depend on ship state and stay
on `Ship`. `player.ts` controls pilot HUD and sound, so it stays client-side.
`drawThrusterGlow` is canvas presentation, not shared simulation behavior;
move it from generic client lighting to the existing client thruster renderer
file. Its debug and benchmark switches remain sourced from lighting and
benchmark modules. Flare rendering and glow placement are per-frame sensitive;
this move should preserve their drawing code and ordering. Class-default
reads occur in collision and damage paths, but four direct static defaults
should behave like inherited defaults. No other production or test caller
uses the base class. The renderer registration runs once at load; no new
per-frame loop or allocation is intended.

Fresh baseline: typecheck/build passed, 126 transformed modules, main chunk
130,136 raw / 47,861 build-reported compressed bytes and 17,849 production
TypeScript lines. Three shared-tick medians were 1.291, 1.297 and 1.296 ms;
rollback-capture medians were 0.181, 0.174 and 0.177 ms; predicted-with-capture
medians were 1.509, 1.511 and 1.552 ms, each with 37 entities. Rendering,
docked, physics, prediction, sound, and full-suite tests protect the move.

### Thruster base class removed (verified)

Deleted `shared/modules/thruster.ts`. All four concrete thrusters now extend
`Module` directly and declare violet shades and disabled physics themselves.
The client thruster renderer registers the same flare drawing function on the
four catalog classes; its glow drawing function moved from generic lighting
into that client thruster file. Ship flight and pilot sound logic remain with
their existing owners. The rendering test now identifies nozzles via the
thruster catalog. Docked tests exercise flare and glow order for all four
engine layouts, and verify their colour, flight, launch and damage behavior.

The full test suite, typecheck, warning-free lint, formatting and production
build passed. Build transformed 125 modules instead of 126. The main chunk
changed from 130,136 raw / 47,861 compressed bytes to 130,281 raw / 47,880
compressed bytes; production TypeScript changed from 17,849 to 17,864 lines.
The small increase comes from four explicit class defaults and renderer
registrations replacing one inherited base. Three post-change shared-tick
medians were 1.310, 1.284 and 1.295 ms versus 1.291, 1.297 and 1.296 ms
before; rollback-capture medians were 0.172, 0.181 and 0.177 ms versus 0.181,
0.174 and 0.177 ms; predicted-with-capture medians were 1.530, 1.535 and
1.514 ms versus 1.509, 1.511 and 1.552 ms. Variation shows no sustained
shared simulation regression. No per-frame loop or allocation was added;
registration now happens four times at startup rather than once. Browser
benchmarks remain excluded by the user's choice.

## Launch helper inventory and baseline (2026-09-25)

`shared/simulation/docking.ts` exports one `launch(ship)` function that clears
`dockedTo` and sets `launching = 3`. Its only callers are the client docked-menu
back action and the docked gameplay test. `shared/craft/control-ship.ts` repeats
the same two assignments when the authoritative/predicted input requests
launch. `Ship.update` advances the timer and applies the current launch flight
behavior; `Craft.update` pins docked craft to their station. Put the two-field
state transition in `Craft.launch()` and use it in the menu, control path and
test, then delete the helper file. This gives another Craft subclass access to
the state transition without moving ship-specific flight and throttle logic.
The menu must continue setting `launchRequested` and `started` separately.
No saved or wire fields change: both `dockedTo` and `launching` are already
replicated and included in rollback state. The transition runs once per
launch, outside the simulation hot loop; the subsequent `Ship.update` behavior
must remain unchanged.

Fresh baseline: typecheck/build passed, 125 transformed modules, main chunk
130,281 raw / 47,880 build-reported compressed bytes and 17,864 production
TypeScript lines. Three shared-tick medians were 1.301, 1.345 and 1.310 ms;
rollback-capture medians were 0.180, 0.175 and 0.188 ms; predicted-with-capture
medians were 1.530, 1.602 and 1.527 ms, each with 37 entities. Docked,
server, prediction, snapshot and full-suite tests protect the change.

### Launch state moved onto Craft (verified)

Added `Craft.launch()` for the common transition (`dockedTo = undefined`,
`launching = 3`), changed docked UI and shared ship controls to call it, and
removed `simulation/docking.ts`. The docked test calls the inherited method.
`Ship.update` continues to advance the timer and apply the existing launch
thrust and steering; the menu still sets its local `launchRequested` and
`started` flags. A future craft subclass can use the transition and supply
its own launch movement if needed. No rollback or network field changed.

The full test suite, typecheck, lint, formatting and production build passed.
Build transformed 124 modules instead of 125. The main chunk changed from
130,281 raw / 47,880 compressed bytes to 130,305 raw / 47,884 compressed
bytes; the lazy docked chunk became smaller (5.63 to 5.59 kB as reported by
the build). Production TypeScript decreased from 17,864 to 17,861 lines.
Three post-change shared-tick medians were 1.282, 1.292 and 1.286 ms versus
1.301, 1.345 and 1.310 ms before; rollback-capture medians were 0.179,
0.175 and 0.175 ms versus 0.180, 0.175 and 0.188 ms; predicted-with-capture
medians were 1.522, 1.537 and 1.509 ms versus 1.530, 1.602 and 1.527 ms.
No sustained regression or new per-tick allocation is evident. Browser
benchmarks remain excluded by the user's choice.

## Raw keys versus player commands: inventory and baseline (2026-09-25)

`client/input.ts` currently owns both browser key collection (`pressed`,
keydown/up/blur listeners, bindings and callbacks) and the mutable
`playerInput`. Its private `updateMovement` translates held keys into thrust
and turn on every key transition; the same event handler interprets module
toggle keys and copies the command state when it changes. `client/main.ts`
sends `playerInput` into network prediction; input and module-input tests also
read it. No server or shared simulation code calls `updateMovement` directly.
The test protects synchronous tap and release, focus loss, immutable change
snapshots, toggle-once behavior, and production-mangled bindings.

Keep the raw key set, listeners, action bindings and browser callback dispatch
in `client/input.ts`. Give command translation and the plain `playerInput`
object to a new `client/player-input.ts`. Keydown passes the normalized key to
the translator for toggles; keyup/blur update movement only. The translator
returns a copied command state only when it changed. This preserves event
order and the plain `PlayerInput` wire shape; placing a method on the object
would add an unintended enumerable field when callers spread it. Update
production and tests to import that object from its new owner. The work occurs
on key events, outside the simulation tick; no new per-tick computation or
allocation is intended. The added source module may change bundle size.

Fresh baseline: typecheck/build passed, 124 transformed modules, main chunk
130,305 raw / 47,884 build-reported compressed bytes and 17,861 production
TypeScript lines. Three shared-tick medians were 1.296, 1.279 and 1.307 ms;
rollback-capture medians were 0.178, 0.180 and 0.180 ms; predicted-with-capture
medians were 1.531, 1.532 and 1.533 ms, each with 37 entities.

### Player-input translation moved (verified)

Added `client/player-input.ts` for the mutable `playerInput` data and
key-to-command translation. `client/input.ts` now collects raw key transitions,
keeps the pressed-key set, invokes binding callbacks, and forwards keys to the
translator. The translator retains the same movement arithmetic, module
toggle rules and changed-state comparison; it returns a copy only when the
commands change. Main and tests now import `playerInput` from its owner.
`PlayerInput` remains plain data with the same network and prediction shape.

Input and module-input tests passed before the full suite. The full test suite,
typecheck, lint, formatting and production build then passed. Build
transformed 125 modules instead of 124. The main chunk changed from 130,305
raw / 47,884 compressed bytes to 130,291 raw / 47,922 compressed bytes;
production TypeScript changed from 17,861 to 17,863 lines. Three post-change
shared-tick medians were 1.297, 1.287 and 1.288 ms versus 1.296, 1.279 and
1.307 ms before; rollback-capture medians were 0.176, 0.178 and 0.176 ms
versus 0.178, 0.180 and 0.180 ms; predicted-with-capture medians were 1.543,
1.524 and 1.511 ms versus 1.531, 1.532 and 1.533 ms. No sustained shared
simulation regression is evident; this path runs on key events and adds no
per-tick allocation. Browser benchmarks remain excluded by the user's choice.

## Keybinding movement correction: inventory and baseline (2026-09-25)

The new `client/player-input.ts` has no independent state or callers beyond
`client/input.ts`, `client/main.ts`, and two tests. It owns the plain
`playerInput`, movement arithmetic, module toggles and changed-state copy.
The user clarified that this extra file is unnecessary; the specific rule to
move is the right-key minus left-key turn calculation. `client/keybindings.ts`
already owns separate left, right and forward key definitions and is the
natural owner for resolving those held keys to `{ thrust, turn }`.
Restore the plain `playerInput`, toggle handling and changed-state notification
to `client/input.ts`; call a small `movementFromKeys` function in
`client/keybindings.ts` for the arithmetic, then delete `player-input.ts`.
Update main and tests to import `playerInput` from `input.ts` again. Keyboard
snapshots, wire data, callback order and mapping for remapped keys remain
unchanged. This runs on key transitions, outside the simulation tick.

Fresh baseline: typecheck/build passed, 125 transformed modules, main chunk
130,291 raw / 47,922 build-reported compressed bytes and 17,863 production
TypeScript lines. Three shared-tick medians were 1.285, 1.289 and 1.282 ms;
rollback-capture medians were 0.175, 0.175 and 0.175 ms; predicted-with-capture
medians were 1.511, 1.516 and 1.522 ms, each with 37 entities.

### Movement mapping simplified (verified)

Removed the extra `client/player-input.ts` file. `client/input.ts` again owns
the plain `playerInput`, key transitions, toggle handling and change
notification. `client/keybindings.ts` now owns `updateMovement`, which checks
the independently configurable forward, left and right bindings and writes
thrust and turn to the existing command object. The right-minus-left rule is
absent from `input.ts`, and the update creates no temporary movement object.
Main and tests again import `playerInput` directly from `input.ts`.

Focused input tests and the full test suite, typecheck, lint, formatting and
production build passed. Build transformed 124 modules instead of 125. The
main chunk changed from 130,291 raw / 47,922 compressed bytes to 130,301 raw
/ 47,895 compressed bytes; production TypeScript changed from 17,863 to
17,866 lines. Three post-change shared-tick medians were 1.276, 1.290 and
1.281 ms versus 1.285, 1.289 and 1.282 ms before; rollback-capture medians
were 0.174, 0.175 and 0.177 ms versus 0.175, 0.175 and 0.175 ms;
predicted-with-capture medians were 1.519, 1.525 and 1.525 ms versus 1.511,
1.516 and 1.522 ms. These are within baseline variation. Keyboard behavior
and the plain network command shape are unchanged. Browser benchmarks remain
excluded by the user's choice.

## Finite-mass collision bodies (2026-09-25)

The game now gives generic loose objects, including unequipped modules, an
item-scale mass of 6. Mounted module segments still use their craft body, and
module wreckage still uses a separate craft body. Shape-less loose objects no
longer create point collision fixtures; this prevents coincident dropped cargo
from generating pairwise contacts. Current craft fracture and module detach
paths create fragments with segments; empty hulls are removed. Corral stations
use finite mass 1e9, making collision recoil negligible
while leaving the existing reduced-mass damage calculation effectively
unchanged for ship-station impacts.

With all game collision bodies using positive finite mass, the solver no longer
needs dynamic/kinematic types, type-change body recreation, or kinematic-only
island and pair filters. The 12-module overlap regression reports zero
contacts. Full tests, lint, formatting and production build passed. The main
chunk fell from 48,295 to 48,185 build-reported compressed bytes in an
isolated build with unrelated concurrent edits removed. A 37-entity shared
simulation benchmark measured 1.692 ms per tick after the change. The
speculative six-mass fallback for empty fragments was subsequently removed; it
reduced the then-current main chunk by another two compressed bytes.

## Positive-mass follow-up audit (2026-09-25)

A source-wide search found no remaining dynamic/kinematic body type or
sleep transition, and no zero-mass branch in the physics or collision path. Every game collision body is assigned its positive
object mass when its fixtures are first synchronized. The previous body
creation also calculated inverse mass before fixture construction, then
calculated it again with inertia; that first calculation is gone. The cargo
release path no longer tests whether its object's mass is positive.

The solver still carried an always-true awake flag and checks on every island
and contact traversal. These were removed. Position and velocity constraints
also stored two copies of the same inverse mass and inverse inertia. They now
share one set. The sweep's local center was always zero, so its offset field and
rotation work were removed. The always-enabled block solver flag, unused
inverse-time-step value, and reciprocal guards whose denominator must be
positive for two finite-mass bodies were removed. The contact pool no longer
clears solver fields on release and again before use; initialization now resets
only the impulses for active manifold points. Reused contacts retain their
lifecycle reset, and material response reads the contact's friction and
restitution directly rather than copying them into constraint fields.

The remaining zero values have different meanings: a body with no physical
shape has zero inverse rotational inertia, and TOI position correction assigns
zero _local_ inverse mass to neighboring bodies outside the primary TOI pair.
That TOI case also requires the effective-mass guard. Nonphysical fixtures
still report docking, cargo, and drill contacts without solver response.
Contact flags for enabled/touching, island traversal, TOI caching, fixture
creation, and world locking all have live callers. A zero-duration world step
is also used for contact sampling.

The main production chunk changed from 48,459 to 47,607 build-reported
compressed bytes in this working tree, a reduction of 852 bytes. The sound and
docked chunks remained about 1.69 and 5.41 kB raw, with no loading change.
Across the seven edited TypeScript files, the follow-up removed 290 lines and
added 66, including formatting. Full tests, typecheck, lint, and build passed.
Two sequential paired runs against a temporary copy containing the exact
pre-audit physics files measured shared-tick medians of 1.825 and 1.780 ms
before, versus 1.784 and 1.729 ms after, with 37 entities. Predicted-tick
medians were 2.156 and 2.110 ms before, versus 2.069 and 2.089 ms after.
This scenario shows no simulation regression; it does not measure browser
rendering or every collision density.

## Vector math ownership and sweep location (2026-09-25)

`src/shared/common` contained only three active files: vector output helpers,
rigid transforms, and swept motion. The five scalar vector formulas now live
with `Vec2` in `vector.ts`; its instance `dot` calls the local formula. The
remaining allocation-free vector and transform operations, transform types,
and `Transform` class share `vector-math.ts`. `Sweep` is now in
`dynamics/motion-sweep.ts`, beside the body and solver that own it. The empty
`common` directory and the unused `Vec2.setZero` method were removed. This
reduces three helper files to two and avoids a runtime import cycle between
`Vec2` and `Transform`.

The solver still writes into plain `{x, y}` scratch values. Those values need
out-parameter functions such as `zeroVec2` and `copyVec2`; making them `Vec2`
methods would change allocation and call behavior. A prior measured trial of
static `Vec2` scalar methods increased both chunk size and tick time, so the
scalar formulas remain named functions. No loading trigger or lazy import
changed.

The build transformed 121 modules instead of 122. The main chunk fell from
47,607 to 47,583 build-reported compressed bytes; the sound and docked chunks
remained about 1.69 and 5.41 kB raw. The full test suite passed after moving
the modules; typecheck, lint, formatting, and the final build passed after
removing the unused method. Two paired shared-simulation benchmark runs of
the old and reorganized modules overlapped: 1.763/1.765 ms per tick before and
1.745/1.810 ms after with 37 entities. Predicted-tick medians were
2.084/2.070 ms before and 2.113/2.081 ms after. There is no clear sustained
change in this scenario.

## Physics and collision folder ownership (2026-09-25)

Renamed `shared/dynamics` to `shared/physics` and removed the redundant
`physics-` and `collision-` prefixes from its body, world, solver, fixture,
and contact files. The sweep moved with them. The general force application
used by craft fracture moved from `simulation` to `physics` and now accepts a
`GameObject` type instead of `any`. The abstract collision shape lives with
its concrete shapes at `collision/shape/base.ts`.

`collision/outer-edges.ts` was unrelated to contact detection: it marks polygon
boundary edges and groups connected polygon pieces for craft and asteroid
geometry. It now lives in the existing `polygon.ts`; the extra file is gone.
`Outline` likewise has one definition in shared `types.ts`, while collider and
contact types remain in `collision/types.ts`. The broad phase, shape distance,
manifold, contact query, TOI, and gameplay collision adapter remain in
`collision`. General vector math, rendering geometry, shared settings, and the
reusable object pool keep their existing owners. Simulation movement and tier
scheduling remain in `simulation`.

The build transformed 120 modules instead of 121. The main chunk changed from
47,583 to 47,573 build-reported compressed bytes. Sound and docked chunks
remain about 1.69 and 5.41 kB raw, with the same loading triggers. The full
test suite, typecheck, lint, formatting, and production build passed. Two paired 37-entity benchmark runs
measured shared-tick medians of 1.799/1.740 ms before and 1.727/1.730 ms
after; predicted-tick medians were 2.018/2.024 ms before and 2.014/2.043 ms
after. The move shows no sustained slowdown in this scenario.
