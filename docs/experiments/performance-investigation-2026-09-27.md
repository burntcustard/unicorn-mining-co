# Collision and physics investigation, 27 September 2026

Baseline: deployed commit `3a7b5f1`, confirmed by `fly status` image metadata.
The machine remains in `lhr` with two shared vCPUs and 512 MiB RAM. No deployment
or machine configuration change was made during this investigation.

## Production-only cache failure

The live CPU profile exposed a genuine production-only bug in snapshot
preparation. Property mangling renamed `segments` to `O` in the deployed build,
but the dynamic test `key === 'segments'` became `key === '_segments'`. The
comparison never matched. Production therefore fell back to repeatedly
`JSON.stringify`-ing asteroid segment geometry instead of using the cache that
worked in source benchmarks.

The fix compares the current value with `full.segments`; both property accesses
now go through the same mangling. Packet contents and mutation detection are
unchanged. A new production-build regression reproduces **17 unnecessary array
serializations before the fix and zero afterward**, for both mutable and locked
geometry. It separately checks health, contents and replacement-vertex deltas.

This explains why measuring only the source server gave an incomplete picture.
`benchmarking/production-flight.mjs` now compiles the same workload through the
real property-mangling and final compression pipeline. Its benchmark-only
`--broken-cache` option reproduces the old branch without modifying source files,
so both variants retain the same physics and field-name mapping.

A 45-second, 1 ms sampling profile was collected inside the live machine during
the three-player browser flight. Snapshot normalization was the largest
self-sampled game function. The temporary inspector listened only on localhost
and was closed afterward; the game process was not restarted. The live profile
and browser run were of the deployed baseline, not of the uncommitted fix.

## Interpreting the new graph

A single vCPU reaching 6% does not by itself mean the machine is being throttled.
Fly currently gives each shared vCPU 5 ms per 80 ms period, **pooled across the
machine**. Two vCPUs therefore provide 10 ms per period, equivalent to 12.5% of
one core; the normalized dashboard baseline remains 6.25%. The supplied graph
has average utilization below that baseline and no obvious sustained throttle
or steal episode. Short spikes can still be hidden by graph averaging.
[Fly CPU performance documentation](https://docs.fly.io/machines/cpu-performance/).

Read-only SSH inspection of this particular guest reported:

- `AMD EPYC`, family 23, model 49, guest-reported frequency 2499.996 MHz;
- AVX2, FMA, SSE4.2 and F16C exposed;
- Node **26.10.0**; the local benchmark host uses Node **26.8.2** and a Ryzen
  7 5800X3D.

These are guest-visible properties, not a guarantee of a particular host SKU or
all London hosts. Firecracker runs microVMs through KVM and supports CPU feature
masking/templates. This does not identify a separate arithmetic bottleneck we
can eliminate in game code. Targeting one observed host with a native addon
would add a deployment constraint without demonstrated benefit.
[Firecracker overview](https://github.com/firecracker-microvm/firecracker),
[CPU templates](https://github.com/firecracker-microvm/firecracker/blob/main/docs/cpu_templates/cpu-templates.md).

## Work removed

The vendored physics implementation retained contact-feature IDs originally used
to match points for warm starting. Our solver resets impulses in `initConstraint`
and never consumes these IDs. It was nevertheless allocating, copying, swapping,
and clearing them on collision queries.

The retained changes remove those IDs and their wrapper classes, use plain
vectors for contact and clipping points, and stop clearing scratch data which
is fully overwritten before its next use. GJK keeps its index arrays allocated
and resets the active count. TOI reuses the transforms already computed by its
distance query instead of calculating them again during separation setup.

The game also reuses its temporary world manifold and point-velocity vectors.
Reported contacts still own copies of their normal and position. Depth reads
only active manifold points, so a previous two-point collision cannot contaminate
a later one-point collision.

No simulation interval, iteration count, precision, geometry, collision ordering,
protocol or loading trigger changes are retained.

## Experiments rejected

These were implemented and measured, then removed from production code:

| Trial                                                 | Result / reason not retained                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swept enclosing circles before TOI                    | All three flight hashes matched. About 1% incremental benefit in the initial trial, too small for the extra cached geometry and rotation-envelope logic. |
| Whole-body isolation before fixture grid queries      | Preserved replay hashes, but no convincing benefit across routes. The existing grid already groups fixtures by body.                                     |
| One-angle and two-angle rotation caches               | Exact replay, but little benefit for one entry and a regression for the two-entry Float64Array version.                                                  |
| Tighter rotational displacement bound for proxy reuse | Conservative chord-length bound passed the full-sync proxy oracle and preserved hashes; did not improve total CPU.                                       |
| Fat AABB padding 10 → 2                               | Changed contact arrival/order, trajectories, fractures and entity counts. Its flight CPU numbers are not an equivalent-workload comparison; rejected.    |
| Early exit in polygon SAT / hoisted dot product       | Correct replay but no dependable full-game CPU gain.                                                                                                     |
| GJK `hypot` → squared distance plus square root       | Replays matched, but no useful end-to-end gain; kept existing arithmetic.                                                                                |
| Craft getter temporary-array changes                  | No consistent gain across repeated flight workloads; removed.                                                                                            |

Distance scheduling already exists: visible objects move at 60 Hz, distant
objects at 15 Hz, and collision sweeps run at 30 Hz. Simply omitting physics for
an object far from a player is unsafe: it can still hit another object. A future
coarse-body/lazy-fixture design must cover translation, rotation, newly loaded
geometry, existing contacts and collision-induced motion. The tested body-level
query shortcut did not justify such a rewrite in this pass.

## Typed arrays, Wasm and workers

`benchmarking/physics-bounds-kernels.mjs` runs each representation in a separate
process to avoid V8 polymorphism bias. It includes a real Float64 SIMD Wasm
kernel, with readable WAT beside the harness. Inputs are already packed and the
kernel returns a checksum, deliberately giving Wasm a favorable comparison.
This is an isolated bounds calculation, not a claim about rewriting the entire
solver in Wasm.

Median elapsed nanoseconds per polygon, three runs:

| Representation              | 8 vertices | 24 vertices |
| --------------------------- | ---------: | ----------: |
| Ordinary JavaScript vectors |      43.32 |       93.75 |
| Float64Array                |      44.14 |       87.43 |
| Float32Array                |      45.32 |       90.76 |
| Float16Array                |      57.05 |      115.99 |
| Float64 SIMD Wasm           |      48.47 |       93.57 |

The small Float64 win for larger polygons does not establish a full-game gain;
packing/copying and integrating mutable shapes would add work. Float16 maps both
`20000.1` and `20000.2` to `20000`, and `70000` to infinity. Integer coordinate
arrays likewise require scaling/range constraints; none were added to physics.
The [wasm-math project](https://github.com/AFE-GmdG/wasm-math) is useful inspiration,
but its vector/matrix results do not demonstrate a speedup for this 2D kernel.

A persistent two-worker experiment preloads geometry and sends only batch sizes:

| Bounds per batch | Serial elapsed / total CPU, µs | Two workers elapsed / total CPU, µs |
| ---------------- | -----------------------------: | ----------------------------------: |
| 200              |                    6.85 / 6.97 |                       19.62 / 37.11 |
| 2,000            |                  84.17 / 84.16 |                      62.50 / 119.82 |

The larger batch finishes sooner but consumes **42% more CPU**, even before
transferring live physics state. That trades latency for more quota consumption.
A worker pool may become useful at substantially larger workloads; it is not a
CPU-saving fix demonstrated here.
[Node worker documentation](https://nodejs.org/api/worker_threads.html).

## Measurement and validation

The complete production pipeline comparison isolates the snapshot-cache fix:
both variants include the final physics code, and the baseline restores only
the broken key-literal branch. These are local CPU measurements, not measurements
of the fix deployed on Fly. Runs were serialized on the same two physical cores,
with a warm-up replay and ABBA ordering (two measured runs per variant per route).
Each three-player run simulates 9,000 ticks, or five minutes, with thrust and
steering but no mining.

| Three-player route | Before CPU ms/tick | After CPU ms/tick | Reduction |
| ------------------ | -----------------: | ----------------: | --------: |
| Convoy             |             0.8644 |            0.7691 |     11.0% |
| Spread             |             0.7980 |            0.6940 |     13.0% |
| Contact            |             0.7925 |            0.7029 |     11.3% |

A separate 36,000-tick solo replay (20 simulated minutes, one fresh process per
variant) used **9.7% less CPU**. Every paired run matched packet hashes, packet
counts, bytes, final player positions, and final/maximum entity counts exactly.
These measurements cover simulation and replication, not real socket transport.

Physics simplification alone did not show a dependable whole-server CPU gain
in repeated source ABBA runs (roughly flat, with 1–2% variation). In one
instrumented convoy pair, `World.step` decreased from 0.2302 to 0.2017 ms/tick,
about 12.4%; replication was essentially unchanged. This phase measurement is
not an additional 12% whole-server saving. The cleanup remains useful because
it removes dead work and **246 net lines of production code** across this pass.

### Browser and live-process checks

Three independent browser players flew locally and three on the deployed live
server for about seven minutes, without mining. The local browser run exercised
the shared-physics changes; the production-only cache bug did not apply to that
source build. The live run exercised the deployed baseline. All six captures
completed without browser errors. After startup:

- Live mean frame intervals were 16.679, 16.666 and 16.666 ms, approximately
  60 FPS. Mean message intervals were 33.334 ms. Worst message gaps were
  254.6, 258.1 and 257.7 ms: no sustained 1 FPS collapse, but occasional gaps
  remain and cannot be attributed to server CPU alone from these captures.
- Local mean frame intervals were 16.818, 17.055 and 20.008 ms (the third client
  averaged about 50 FPS). Mean message intervals were 33.333 ms, with maximum
  gaps of 68.4, 80.4 and 72.6 ms. Six simultaneous browser processes shared the
  workstation; this was not an isolated rendering benchmark.
- Outside the inspector profiling window, 32 ten-second live process samples
  averaged 9.42% of one core and peaked at 13.29%. On the two-vCPU normalized
  graph those become 4.71% and 6.64%. Other public-server users were not excluded,
  so this is not an exclusive three-player capacity measurement.

All investigation browser/dev-server processes were stopped, and the temporary
remote inspector was verified closed. No application restart or deployment was
performed. The new fix still needs a deployed measurement before claiming a
specific Fly CPU reduction or resolution of all lag spikes.

### Correctness and build checks

`npm test` passed, including type checking, production build, packet, collision,
region, prediction, docking and property-mangling suites. `npm run lint` passed.
The repository-wide `npm run format:check` flags only the unchanged
`benchmarking/session-tick.mjs`; changed files pass formatting and `git diff --check`.
The new GJK test checks 500 deterministic rectangle/point pairs against analytic
distance in forward/reverse/forward traversal, exercising reused scratch state.
The new replication regression compiles the actual manager through production
property mangling and detects the cache failure described above.

| Resource  | Before raw / gzip-1 bytes | After raw / gzip-1 bytes |
| --------- | ------------------------: | -----------------------: |
| Main JS   |           96,532 / 42,685 |          94,647 / 42,093 |
| Server JS |           78,876 / 34,017 |          76,964 / 33,397 |
| Docked JS |             4,740 / 2,445 |            4,740 / 2,446 |
| Sound JS  |               1,681 / 942 |              1,681 / 942 |
| HTML      |             3,986 / 1,950 |            3,986 / 1,951 |

Loading boundaries are unchanged. The existing main-bundle 14 KB warning
remains. No dependencies or Fly configuration changed.

Raw simulation, kernel, worker and browser timing results are in
[`benchmarking/results/2026-09-27-physics.json`](../../benchmarking/results/2026-09-27-physics.json).
Commands and benchmark options are documented in
[`benchmarking/README.md`](../../benchmarking/README.md).
