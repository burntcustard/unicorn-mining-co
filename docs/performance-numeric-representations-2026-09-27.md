# Integer and fixed-point investigation — 27 September 2026

No production arithmetic change was retained. The best complete-server candidate
saved only **0.48%**, below the 1% acceptance threshold. Scaling the whole world
by 1,000 is not justified by these results. This is an investigation of selected
fixed-point subsystems and representative arithmetic, **not a completed rewrite
or a benchmark of an entirely integer physics engine**.

## What was tested

Baseline: commit `c52ae10`, including the canvas hotfix and previous Set-iteration
optimization. Node 26.8.2, V8 14.6.202.34-node.28, AMD Ryzen 7 5800X3D.
No deployment or Fly configuration changes. These are local measurements, not
predictions of Fly CPU utilization or Firefox performance.

- 63 measured production flight replays: three repeats of each variant/route,
  including a separate baseline for the follow-up experiment.
- Three players, unchanged convoy, spread and contact routes; real movement,
  collisions, snapshot extraction and JSON serialization, stubbed sockets.
- Each invocation: 300 warm-up + 3,600 measured ticks, preceded by an identical
  untimed session. Total **260 simulated seconds**, below five minutes. Children
  retain the existing 290-second wall-time timeout. No 20-minute tests.
- Fresh processes, 16 MiB semi-space, sequential runs, varied variant order.
  Reported CPU is user + system time, including background V8 work. Tables use
  medians of three runs. Overall change compares sums of the three route medians.
- 100 short kernel measurements: five fresh-process repetitions for each of
  five representations and four operations, reversing order on alternate passes.
- Controlled collision checks: four scenarios at three world offsets, 600 ticks
  each, across six implementations. No timing instrumentation in flight CPU runs.
- One separate detailed three-player spread profile to locate relevant costs.

## Three-player server CPU

Milliseconds of process CPU per measured tick; lower is better. Positive change
means more CPU. Each row compares with its own experiment's baseline.

| Experiment                                    |   Spread |   Convoy |  Contact | Overall change |
| --------------------------------------------- | -------: | -------: | -------: | -------------: |
| Baseline                                      | 0.609680 | 0.435233 | 0.486081 |              — |
| Fixed bounds ×1,000                           | 0.609461 | 0.442601 | 0.498662 |     **+1.29%** |
| Fixed bounds ×1,024                           | 0.618264 | 0.443098 | 0.496517 |     **+1.76%** |
| Round positions to 0.001                      | 0.583573 | 0.510858 | 0.439065 |        +0.16%¹ |
| Initialize vector fields as doubles           | 0.608814 | 0.433533 | 0.487634 |         −0.07% |
| Follow-up baseline                            | 0.619381 | 0.435899 | 0.488729 |              — |
| Fixed bounds ×1,000, separate integer classes | 0.607179 | 0.439209 | 0.490161 |     **−0.48%** |

¹ This is not a like-for-like speed comparison: rounding changed collisions,
flight paths, active entity counts and packet volume. At the end, one or more
players were 19,199–22,204 world units from their reference-route endpoints.
That is trajectory divergence after repeated collisions, not evidence of a
20,000-unit visual collision gap. The convoy used 17.38% more CPU; the contact
route used 9.67% less. Those changes cannot be credited to faster arithmetic.

All the other variants matched baseline packet hashes, bytes, final player
positions and entity counts on all three routes. None achieved a repeatable
whole-server saving above 1%.

The integer-class follow-up was noisy: spread ranged from 0.604953 to 0.668731
ms/tick, versus baseline 0.611655–0.620943. Even using the favorable medians,
its aggregate gain was only 0.48%. Its median peak RSS was approximately
244/242/238 MiB across spread/convoy/contact, compared with 250/245/240 MiB for
its baseline. These process peaks include startup, both sessions and GC timing;
they do not demonstrate a precise retained-memory saving.

## Implementation details

`numeric-experiments.mjs` applies build-time transformations only when requested
by the benchmark. It does not change files under `src`.

**Fixed bounds:** proxy and group bounding boxes retain integer coordinates at
1,000 or 1,024 units per world unit. Lower bounds round down and upper bounds
round up, so conversion cannot shrink a collision candidate's box. Cell sizes,
fat-bound margins and displacement extensions use matching units. Fixture reuse
margins convert back to world units. Narrow-phase geometry, impulses, actual
object positions, rendering and packets remain unchanged. Queries compare the
integer bounds directly; this is actual scaled integer-valued storage, not
simply rounding floats and immediately dividing them again.

The first prototypes still use the shared vector/AABB representation and use
signed-32-bit extrema to initialize group bounds. They are bounded-area
experiments: those sentinels are unsuitable outside their representable world
range. They must not be deployed as general-purpose grid replacements.

**Separate integer classes:** the follow-up gives grid coordinates their own
class, avoiding the shared vector shape's double representation, and initializes
group bounds from the first actual fixture instead of floating-point Infinity
or limited-range sentinels. It retains normal Number arithmetic without coercing
coordinates through `|0`, so larger values can fall back to double representation
instead of silently wrapping.

A first compilation of this follow-up exposed the build's mangling of native
iterator `.next()`. That failed run was excluded; the final prototype reuses the
already required spread array instead. All reported follow-up runs completed
through the production minifier. This is one reason source-only benchmarks are
insufficient here.

**Position rounding:** only `roundMotion()`'s x/y precision changes from 1e-8 to
1e-3. Angles, velocities and geometry retain their existing precision. This probes
quantization error and its runtime consequences; it is **not integer storage**.

**Double initialization:** `Vec.create()` initializes x/y with NaN, then assigns
the requested values. This tests the article's representation-stability idea
without changing numeric outputs. It produced no meaningful saving.

## Arithmetic kernels

Median elapsed nanoseconds per operation. Inputs are prepared before measurement;
there is no live-world packing/unpacking cost in these results. Objects and typed
arrays run in separate processes to avoid cross-representation feedback.

| Operation                      | Float objects | Fixed objects ×1,000 | Float64Array | Int32Array ×1,000 |
| ------------------------------ | ------------: | -------------------: | -----------: | ----------------: |
| Add precomputed movement delta |         2.094 |                2.099 |    **1.144** |             1.747 |
| Integrate velocity at 30 Hz    |         2.209 |                3.361 |    **2.074** |             4.358 |
| Rotate local coordinate        |         1.719 |                3.050 |    **0.816** |             2.894 |
| Squared local distance         |         1.733 |                1.470 |    **0.856** |             1.158 |

Fixed-point rotation uses integer sine/cosine coefficients scaled by 2²⁰,
wide Number multiplication and rounding back to the position scale. A further
`Math.imul`/shift rotation using 2¹² coefficients took **1.901 ns** on objects,
still slower than floating-point objects in this run. It is valid only for the
small bounded local coordinates used in this kernel; those multiplications
cannot safely handle arbitrary world coordinates.

The maximum tested rotation error was 0.001158 world units with 2²⁰ coefficients,
and 0.029491 with 2¹² coefficients, at radius 170. These are single-transform
errors, not guarantees for repeated solver iterations.

Integer-object squared distance did improve this isolated loop by about 15%,
but its products already exceed Int32 and require wider arithmetic. The packed
floating-point version was substantially faster still. Prepacked integers use
48 KiB for these 2,048 six-number records versus 96 KiB for Float64Array payloads.
This excludes object metadata and the benchmark's input staging data. It does
not mean the entire game's heap would halve.

The useful lead here is **data layout and removing indirection**, particularly
for homogeneous hot data. These kernel timings do not justify replacing live
objects with arrays until the costs of maintaining the arrays, cache invalidation
and converting results are included in a complete-server comparison.

## Accuracy and the two-pixel constraint

Scenarios: a 5,000-unit/s circle hitting a thin wall, an oblique rotating polygon
impact, circle-circle contact, and slow sustained pushing. Each ran for 20
simulated seconds at offsets 0, +49,999 and −49,999 on both axes.

Both fixed-bound variants, the separate-integer-class variant and double
initialization produced **zero trajectory or contact-depth difference** in these
checks. The grid only conservatively expands candidate bounds; actual response
uses the original solver.

Position rounding was more complicated:

| Scenario               | Max edge-displacement bound vs baseline, pixels² | Increase in maximum penetration, world units |
| ---------------------- | -----------------------------------------------: | -------------------------------------------: |
| Fast thin-wall impact  |                                           0.6615 |                                     0.000500 |
| Oblique polygon impact |                                           5.1112 |                                     0.007629 |
| Circle-circle          |                                           1.5221 |                                     0.001008 |
| Sustained pushing      |                                           0.6850 |                                    −0.026665 |

² At 3,840 CSS pixels wide and the current default `game.size = 1.5`, using
`game.scale = width / 1080`. Edge-displacement bound = centre displacement plus
radius × angular displacement, compared at the same tick. This measures drift
from the reference motion, **not a rendered gap or actual penetration**.

The additional peak penetration in the oblique test is about **0.027 pixels** at
that scale, but accumulated motion diverged, and it had 47 fewer contact ticks.
A single 0.001-unit rounding step is tiny; repeated dynamics do not inherit that
same error bound. No candidate was installed, so no gameplay or visual change
is being accepted. These numerical probes do not certify a full fixed-point
rewrite against the user's two-pixel visual requirement; that would require
rendered tests of the rewritten solver, docking, drilling and contacts.

## What the V8 articles mean here

The [React article](https://v8.dev/blog/react-cliff) was read in full. Its concrete
bug combined field-representation changes with non-extensible objects, and was
fixed in V8 7.4. Its useful advice is consistent object initialization and suitable
field values; it does not establish a speedup for replacing this physics engine.

V8's [Maglev explanation](https://v8.dev/blog/maglev) describes unboxing numeric
values and using floating-point registers, without allocating a fresh number
object for every arithmetic operation. JavaScript Number semantics do not imply
that every addition pays a boxed floating-point allocation cost.

[Pointer compression](https://v8.dev/blog/pointer-compression) also makes the
integer representation dependent on the V8 build. This Node build reports
`v8_enable_pointer_compression = 0`; a native diagnostic confirms a signed
32-bit Smi range. Chrome's compressed representation has a signed 31-bit payload.
Code shared by the browser and server must not assume these limits are identical.

The diagnostic also showed that assigning 50,000,000 back into a vector after
its shared shape accepted doubles left a HeapNumber-valued field. A separate
integer-point class stored it as a small integer. That motivated the follow-up
rather than assuming `Number.isInteger(value)` proves integer storage.

## Range, units and implementation implications

Multiplying −6,860 by 1,000 yields **−6,860,000**, not −68,600,000. The latter
would use a factor of 10,000.

At scale 1,000:

- A coordinate within ±50,000 becomes ±50,000,000 and fits both Smi ranges.
- Signed Int32 storage reaches roughly ±2,147,483 world units; a signed 31-bit
  Smi reaches roughly ±1,073,741. Coordinates alone are not the difficult part.
- A single squared difference exceeds signed Int32 once the world-space
  difference exceeds **46.34 units**. Most of our interesting collision geometry
  is already larger than that.
- `Math.imul(200000, 200000)` returns 1,345,294,336 instead of 40,000,000,000.
  Taking its square root and dividing by 1,000 gives **36.68 instead of 200**.
  `|0`, shifts and Int32Array writes cannot be used indiscriminately.
- Number multiplication preserves integer products only within its safe range.
  At this scale a single squared delta reaches that limit at about **94,906
  world units**, or **67,109 on each axis** when summing two squares. Two objects
  on opposite sides of the starting area can exceed it. Local coordinates and
  subtracting before squaring are necessary for tight arithmetic bounds.
- Scaling distances does not make `dt`, sine/cosine, normalized directions,
  inverse mass, drag or time-of-impact fractions integral. They need separate
  scales, wide intermediates, rescaling and carefully chosen rounding policies.
- For example, a mass of 1e9 has inverse mass 1e-9; quantizing every quantity to
  thousandths would erase it. Position precision is not solver precision.
- Linear tolerances, squared tolerances and moment of inertia scale differently.
  Models can remain authored in convenient units, but geometry import, collision
  radii, region coordinates, movement, networking, client prediction and rendering
  all need consistent conversion boundaries. Display division alone is not enough.

The integer kernels were allowed to prepack all inputs. Even under that favorable
assumption, rounding and rescaling usually erased the benefit here.

## Where the server time remains

One separately instrumented three-player spread run, exclusive foreground elapsed
times, excluding harness hashing/input construction:

| Category                                                      |  Share |
| ------------------------------------------------------------- | -----: |
| Collision, physics, fixture synchronization and broad phase   | ~44.5% |
| Snapshot extraction, deltas and JSON encoding                 | ~27.6% |
| Entity movement, base integration, carrier motion and modules | ~15.5% |
| Region lifecycle and queries                                  |  ~7.1% |
| Session/world bookkeeping and gameplay contacts               |  ~5.3% |

These are hotspot estimates with instrumentation overhead, not attributed Fly CPU
percentages. Only **5.4%** was inside base movement integration, which itself
includes work beyond arithmetic. Replacing coordinate additions alone cannot
remove most server CPU. More promising follow-ups are reducing snapshot traversal
and maintaining compact hot physics data, each with complete-server validation.

## Reproduction and artifacts

```sh
node benchmarking/production-flight.mjs --numeric-experiment=baseline --save=/tmp/numeric-baseline.mjs --scenario=spread --ticks=3600 --warm --semi-space=16
node benchmarking/production-flight.mjs --numeric-experiment=grid1000-smi --save=/tmp/numeric-integers.mjs --scenario=spread --ticks=3600 --warm --semi-space=16
node benchmarking/production-flight.mjs --bundle=/tmp/numeric-baseline.mjs --scenario=convoy --ticks=3600 --warm --semi-space=16
node benchmarking/numeric-kernels.mjs
node benchmarking/numeric-accuracy.mjs
```

Other `--numeric-experiment` values: `grid1000`, `grid1024`, `position1000`,
`vector-double`. Select `spread`, `convoy` and `contact` separately; repeat each
three times, alternating saved-bundle order. `--bundle` uses the saved code and
does not apply a new experiment. The flight driver still supplies the normal
production property rewriting and compression passes.

The first experiment used variant order baseline/grid1000/grid1024/position1000/
vector-double, rotated by repetition and reversed for convoy. The follow-up
alternated baseline/grid1000-smi, also reversing convoy order.

[Raw results](../benchmarking/results/2026-09-27-numeric-representations.json)
include every measured flight, kernel samples, accuracy results, phase profile
and the V8 representation diagnostic. Failed prototype compilation/runs and the
initial exploratory timing pair are excluded from timing summaries.

Production source and deployment flags are unchanged. Build output remains:
main 96,688 raw / 42,964 gzip-1 bytes; docked 4,740 / 2,446;
sound 1,681 / 942; server 81,210 / 35,018.

Validation: production build, existing collision tests and lint passed. The
experimental accuracy comparisons completed without nonfinite state. No browser
or live-server visual test was performed for these rejected arithmetic variants.
