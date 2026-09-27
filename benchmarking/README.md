# Browser benchmarking

Run the repeatable browser benchmark with:

```sh
npm run benchmark
```

It starts Vite in the dedicated `benchmark` mode, opens a clean Chrome window,
and tests at a 2880 x 1800 viewport matching a high-resolution MacBook Pro.
The suite isolates the sky modes, background, lighting effects,
movement, collision detection, and all physics. It prints each result as it
completes and finishes with machine-readable JSON.

The benchmark-only query switches in `src/client/main.ts` and `src/client/lighting.ts` are
removed from normal builds by Vite. They are not available in the development
or release modes.

Environment variables:

- `BENCH_SECONDS`: measurement time per test; default `5`.
- `BENCH_WARMUP`: page warm-up time per test; default `2`.
- `BENCH_FILTER`: run only tests whose names contain this text.
- `BENCH_HEADLESS=1`: run Chrome headlessly (useful in CI). By default the
  benchmark is visible in a normal Chrome window while it runs.
- `BENCH_GAME_PORT`: local Vite port; default `4273`.
- `BENCH_DEBUG_PORT`: Chrome debugging port; default `9333`.
- `CHROME_BIN`: Chrome or Chromium executable; default `google-chrome`.

The absolute result depends heavily on whether Chrome uses hardware or software
rasterization. Comparisons between variants from the same run are the useful
part.

## Server tick profiling

```sh
node --import tsx benchmarking/server-performance.mjs
node --import tsx benchmarking/server-performance.mjs --flight
```

The first command measures empty, one-player and three-player sessions at spawn
and in the northern asteroid field. The second moves one player through ten
minutes of simulation at 300 world units per simulated second, without sending
mining inputs. It sets the position directly to keep the route repeatable; it is
not a browser flight or a real-time networking test.

Each JSON line covers 1,000 ticks and includes wall time, process CPU time,
active entities, loaded/saved regions, sleeping entities, and nested phase costs.
`geometry` is part of `collisions`, as is `solver`: do not add those columns.
Phase costs are total milliseconds across the block; `wallPerTick` and
`cpuPerTick` are milliseconds per tick. Socket stubs still serialize outgoing
packets, but exclude actual transport. Run on the same machine before and after
changes; these source-server measurements do not predict production capacity.

## Three-player flight CPU comparison

```sh
node benchmarking/three-player-flight.mjs --save=/tmp/before.mjs > /tmp/before.jsonl
# After changing the source:
node benchmarking/three-player-flight.mjs --save=/tmp/after.mjs > /tmp/after.jsonl
node benchmarking/three-player-flight.mjs --bundle=/tmp/before.mjs
node benchmarking/three-player-flight.mjs --bundle=/tmp/after.mjs
```

Run these sequentially, with browser captures and other CPU-heavy tests stopped.
The saved bundle freezes the simulation code; the same harness can replay it
later. Keep the workspace dependencies installed because `ws` is external.

Each run uses three players holding thrust with occasional steering, no mining,
and three routes: a convoy, separated players, and an asteroid contact area.
Only the initial placement is assigned directly. The next 300 ticks warm up the
session; the following 9,000 ticks represent five minutes at 30 Hz. Stub sockets
retain real snapshot serialization and hash every outgoing packet. Identical
hashes, byte counts and final positions provide a deterministic behavior check.
The run excludes browser rendering and real network transport.

`cpuMs` is process user + system CPU milliseconds per tick, including background
V8 work; `wallMs` is elapsed time per tick. `p50`, `p95` and `max` cover tick wall
time. Compare repeat runs on the same machine, not these values against a Fly
CPU capacity estimate. `--ticks=3000` shortens the measurement;
`--scenario=convoy` selects one route. `--profile` adds inclusive phase timers
that have their own overhead; use uninstrumented runs for final comparisons.
A V8 sampling profile can be collected with `node --cpu-prof`.

### Comparing broad-phase implementations

Use `--ordered-pairs` on **both** bundles when comparing different collision
indexes. It orders candidate fixture pairs consistently so collision ordering
does not change the flight path, fractures, entity density or outgoing traffic.
The production grid already uses stable fixture ordering; the flag also applies
that order to the former tree. Check all packet hashes, byte counts, positions
and entity counts before comparing CPU results. This normalization adds a small
amount of benchmark-only query work.

Keep the ordinary fresh-process results. Also use `--warm` to measure a running
server after V8 compilation and procedural caches have warmed up: it runs one
complete untimed cycle of the selected routes, creates new sessions, then
measures the same routes. Each measured session still has its usual 300-tick
warm-up and 9,000 measured ticks. Run identical options on both bundles; warmed
and ordinary packet hashes differ because process-wide generated IDs advance.

```sh
node benchmarking/three-player-flight.mjs --bundle=/tmp/before.mjs --ordered-pairs --warm
node benchmarking/three-player-flight.mjs --bundle=/tmp/after.mjs --ordered-pairs --warm
```

### Single-player and physics experiments

`--players=1` (or `2`) selects the first players from the same routes. For a
20-minute single-player simulation, run:

```sh
node benchmarking/three-player-flight.mjs --bundle=/tmp/before.mjs --players=1 --ticks=36000 --scenario=convoy
```

The following isolated experiments compare polygon bounds using ordinary
objects, Float64/Float32/Float16 arrays, Float64 SIMD WebAssembly, and a persistent
two-worker pool:

```sh
node benchmarking/physics-bounds-kernels.mjs
node benchmarking/physics-workers.mjs
```

They are microbenchmarks, **not full-game CPU estimates**. Kernel representations
run in separate processes; geometry is already packed, and the Wasm kernel
returns a checksum rather than copying four bounds back. Its readable source is
`physics-bounds.wat`. Worker geometry is preloaded and messages contain only a
batch size. Neither experiment includes the cost of moving live game state to
another representation or thread. Compare total process CPU as well as elapsed
time; Fly's shared CPU allowance applies across all threads.

### Production flight replay

Use this for server CPU comparisons: it applies the real property rewriting,
shared name cache and final two Terser compression passes to the game and the
same flight workload. Source-only timing can miss optimizations that are broken
by minification. Native crypto and CPU-accounting accesses stay outside the game
property rewrite. Reports use fixed positional values across that boundary.

```sh
node benchmarking/production-flight.mjs --save=/tmp/production-before.mjs --warm
# After a change:
node benchmarking/production-flight.mjs --save=/tmp/production-after.mjs --warm
node benchmarking/production-flight.mjs --bundle=/tmp/production-before.mjs --warm
node benchmarking/production-flight.mjs --bundle=/tmp/production-after.mjs --warm
```

`--players`, `--ticks` and `--scenario` work as in the source harness. Saved
bundles freeze the game and workload; arguments still select the duration and
route. Run comparisons serially. Production packets have mangled names, so
compare hashes between builds with the same field-name mapping; source and
production hashes naturally differ. Also compare positions and entity counts.

`--broken-cache` is a deliberate benchmark-only fault injection reproducing the
September 27 segment-cache bug. It restores the old key-literal comparison in
the build without editing application files. Use it when compiling a saved
baseline to isolate that fix; it has no effect on an already saved bundle.

### Server phase and memory investigation

Use one route per invocation for independently interpretable resource totals:

```sh
node benchmarking/production-flight.mjs --profile --scenario=convoy --ticks=3600 --warm --semi-space=4
node benchmarking/production-flight.mjs --profile=detail --scenario=convoy --ticks=3600 --warm --semi-space=4
node benchmarking/production-flight.mjs --scenario=spread --ticks=3600 --warm --semi-space=16
```

Repeat `convoy`, `spread` and `contact`. Each command above covers 260 simulated
seconds including warm-up. Children have a 290-second wall timeout. Serialize
comparisons, alternate variant order and pin the same available physical CPUs
if using `taskset`; do not run builds or other benchmarks concurrently.

`--profile` injects exclusive elapsed timers through the production build and
passes input transitions through the real wire parser. Nested phases are
subtracted from their callers. Hashing and client wire construction are reported
as harness costs. `--profile=detail` adds per-entity wrappers for snapshot
extraction, base movement, carrier motion and module activation, plus fixture
synchronization, broad-phase searches, contact updates and discrete/continuous
solvers. It adds overhead, especially for methods called per entity. Timings are foreground hotspot estimates, not per-phase process CPU.
Use unprofiled runs for total CPU comparisons. Profiling cannot be combined with
`--broken-cache`.

`--semi-space=N` passes `--max-semi-space-size=N` to the benchmark child only.
`resources` reports process peak RSS, heap limit, GC count and elapsed GC duration.
Those values include the entire child, including warm-up and all selected routes;
`cpuMs` and `costs` cover the measured route. GC time overlaps foreground timings
and must not be added to them. The local host's old-space default is unchanged.
Saved bundles retain their instrumentation; `--bundle` does not rebuild them.

These replays omit actual socket transport/TLS. Results and the optimization
assessment are in [the server phase report](../docs/performance-server-phases-2026-09-27.md).

### Persistent-state comparison and receiver oracle

`--node-flag=--single-threaded-gc` passes an additional Node/V8 flag to a
production-flight child for experiments. Repeat `--node-flag=...` to pass several.
It does not change deployment flags.
Use the same saved bundle and semi-space size for both variants.

`--readable` beautifies the final production-compressed bundle for inspection.
`--sample=/tmp/flight.cpuprofile` collects a V8 sampling profile during the
measured route only, after warm-up; it requires one explicit `--scenario` and
must be used when compiling the bundle. Sampling has overhead: use separate
uninstrumented bundles for CPU comparisons.

```sh
node benchmarking/production-flight.mjs --scenario=spread --ticks=3600 --warm --semi-space=16 --readable --sample=/tmp/flight.cpuprofile --save=/tmp/flight-readable.mjs
```

The [server CPU follow-up](../docs/performance-server-cpu-2026-09-27.md) records
incremental acceptance tests, rejected experiments and the complete-patch
comparison against the deployed baseline.

The replication oracle compares the new implementation with a saved previous
`replication.ts`, reconstructing receiver state with the real client's merge and
null-clear rules after every snapshot:

```sh
git show 442548e:src/server/replication.ts > /tmp/replication-before.ts
node benchmarking/replication-oracle.mjs --reference=/tmp/replication-before.ts --scenario=convoy --ticks=3600
```

Repeat for `spread` and `contact`. These are correctness runs, not performance
measurements: the extra reference implementation and state assertions add work.
The oracle permits redundant deltas and property-order changes, but requires
identical reconstructed state. Entity lifecycle and simulation still run through
the current source in both comparisons.

See [persistent-state results](../docs/performance-persistent-state-2026-09-27.md)
for the retained implementation and the rejected region/GC experiments.

The [collision cache follow-up](../docs/performance-collision-caches-2026-09-27.md)
records three-player production comparisons for persistent motion scratch data,
cached geometry quantization, and a tighter conservative rotation bound.

## Region pre-generation experiments

`region-prewarm.mjs` builds a source-only experimental server bundle; it does not
change production code or deployment configuration. The default radius is 50,000
and seed is 25. Examples:

```sh
node benchmarking/region-prewarm.mjs --mode=descriptions
node benchmarking/region-prewarm.mjs --mode=asteroids --flight --scenario=spread
node benchmarking/region-prewarm.mjs --mode=geometry --compact-geometry --indexed-removal --flight --scenario=spread
node benchmarking/region-prewarm.mjs --mode=bodies --compact-geometry --indexed-removal --validate
node benchmarking/region-prewarm.mjs --mode=bodies --compact-geometry --indexed-removal --flight --old-space=512
```

Compare `cold`, `descriptions`, `geometry` and `bodies` across `spread`, `convoy`
and `contact`, sequentially in alternating order. `--flight` runs three players
for 3,600 measured ticks after 300 warm-up ticks. `--activation` instead measures
151 three-observer placements and cannot be combined with `--flight`. Other
memory diagnostic modes are `objects`, `hitboxes` and `fixtures`. Geometry and
body modes prepare asteroids only, preserving on-demand wreck cargo ID allocation.

Each child has a 290-second wall timeout and uses a 16 MiB semi-space.
`--cooldown=1000` settles startup work before flight setup and after warm-up.
`--old-space=512` sets the child's V8 old-space limit, not its total RSS; the
reported heap limit verifies flag forwarding. `--memory-limit=2048` is an RSS
stop guard checked between regions during object preparation. Forced GC reports
retained memory between diagnostic stages, outside flight measurements.

Prepared objects stay outside active simulation and are consumed on first
activation. This prototype does not introduce persistent mutable state for
unloaded asteroids. `--validate` checks prepared cache use, geometry invalidation,
mining, cargo pickup and unload/reload behavior for geometry/body modes.

See [the investigation](../docs/performance-region-prewarm-2026-09-27.md) for
memory tradeoffs, indexed removal, limitations and the repeated flight results.

### Production description cache

The server now pre-generates central descriptions using `preGeneratedRadius` in
`src/shared/settings.ts`. The archived `region-prewarm.mjs` experiment disables
that automatic startup step so its explicit preparation stages and `cold` mode
still work. Indexed removal is now normal behavior in every mode;
`--indexed-removal` remains accepted for older commands.

Use `production-flight.mjs --ticks=3600 --warm --players=3 --semi-space=16`
with one `--scenario=spread`, `convoy` or `contact` per invocation for current
production comparisons. Save each implementation with `--save=/tmp/name.mjs`,
then alternate runs using `--bundle=/tmp/name.mjs`. A warmed invocation runs two
3,900-tick sessions (260 simulated seconds total); the child timeout is 290
seconds. Compare snapshot hashes, packet bytes and positions as well as CPU.

See [the implementation measurements](../docs/performance-dormant-world-2026-09-27.md)
for the description-only decision and rejected collision experiments.

`--pre-generated-radius=0` overrides the setting in a newly compiled flight
bundle, leaving the workspace's production setting unchanged. This isolates
startup pre-generation from the remaining implementation. It was used to test
collision skipping alone before that feature was removed. The override is embedded by
`--save`; it has no effect when running an existing `--bundle`.

The [server Set-iteration follow-up](../docs/performance-set-iteration-2026-09-27.md)
compares temporary spread-array conversions while preserving stored Sets,
including independent candidates and the final incremental acceptance checks.

## Integer and fixed-point experiments

`production-flight.mjs --numeric-experiment=NAME` applies a benchmark-only
transformation. Values are `baseline`, `grid1000`, `grid1024`, `grid1000-smi`,
`position1000` and `vector-double`. Use the usual saved-bundle, three-player,
three-route comparison described above; no arithmetic changes enter release builds.

`node benchmarking/numeric-kernels.mjs` compares prepacked object/typed-array
arithmetic in separate processes. `node benchmarking/numeric-accuracy.mjs`
compares thin-wall, oblique, circular and sustained contacts at three world offsets.
These probes do not constitute a complete integer physics implementation.

See [the numeric representation investigation](../docs/performance-numeric-representations-2026-09-27.md)
for CPU measurements, accuracy limits and raw results.

## Elapsed-time catch-up

`production-flight.mjs --batch-ticks=1|2|3|6` runs that many logical 30 Hz ticks
per server callback. Keep `--ticks` divisible by the batch size. Queued inputs
retain their logical tick offsets. The saved bundle embeds the batch size;
passing a new size with `--bundle` does not modify an existing bundle.

```sh
node benchmarking/production-flight.mjs --ticks=1800 --warm --players=3 --semi-space=16 --scenario=spread --batch-ticks=3 --save=/tmp/flight-batch3.mjs
node benchmarking/production-flight.mjs --ticks=1800 --warm --players=3 --semi-space=16 --scenario=convoy --bundle=/tmp/flight-batch3.mjs
```

`cpuMs` and `wallMs` remain normalized per **logical tick**; multiply by the batch
size for cost per callback. `p50`, `p95` and `max` are wall time **per callback**.
Compare equal simulated durations. Coarser collisions change trajectories, so
also inspect positions/entity counts before treating CPU differences as the
cost of the same workload.

See [the elapsed-time report](../docs/performance-elapsed-time-2026-09-27.md) for
normal-rate comparisons, delayed-server/client tests, browser frame times and
limits. `npm run test:server` includes the deterministic three-client lag tests.

## Object-shape and optional-argument experiments

`production-flight.mjs --shape-experiment=NAME` applies one isolated build-time
variant: `required-dt`, `tier-position`, or `world-shape`. Release builds do not
import the experiment module. The variants respectively require an explicit
movement delta, pass a position directly to the tier lookup, or initialize the
world's optional movement-parent cache at creation.

```sh
node benchmarking/production-flight.mjs --ticks=1800 --warm --players=3 --semi-space=16 --scenario=spread --shape-experiment=world-shape --save=/tmp/world-shape.mjs
node benchmarking/production-flight.mjs --ticks=1800 --warm --players=3 --semi-space=16 --scenario=convoy --bundle=/tmp/world-shape.mjs
```

Save the unchanged baseline without `--shape-experiment`. Alternate saved-bundle
runs sequentially; compare packet hashes, byte counts, entity counts and positions.
The experiment is embedded in saved bundles, so new flags do not change a bundle.

For separate V8 diagnostics, use a readable bundle and forward the logging flags:

```sh
node benchmarking/production-flight.mjs --ticks=1800 --warm --scenario=spread --semi-space=16 --readable --save=/tmp/shape-readable.mjs --node-flag=--log-ic --node-flag=--no-logfile-per-isolate --node-flag=--logfile=/tmp/shape-ic.log
node --trace-deopt --trace-file-names --max-semi-space-size=16 /tmp/shape-readable.mjs '[1800,3,true,"spread"]'
```

Diagnostic runs must not be compared with uninstrumented timings. Inline-cache
logs record transitions, not how often a property was read. Startup map changes
and cumulative map counts are not evidence of a continuously megamorphic site.
See [the monomorphism follow-up](../docs/performance-monomorphism-2026-09-27.md).
