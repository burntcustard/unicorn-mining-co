# CPU Performance Investigation: Method and Successful Changes

## Scope

This pass started from the first performance pass, whose production result was roughly a 50% reduction against the original server baseline. The target for this pass was another 25% reduction from that improved server.

The work deliberately stayed inside the existing TypeScript/JavaScript simulation. Rust, Go, WASM and real WebSocket transport were excluded from this pass.

The main questions were:

- Which apparent CPU costs were actually simulation work, allocation work or benchmark noise?
- Which loops and object shapes were causing V8 to allocate or deoptimize?
- Could the recent performance code be simplified without losing its measured gains?
- Could replication be replaced with a cheaper binary protocol?

The binary protocol experiment was ultimately rejected and removed. It was slower in this workload and made packets larger, so it is not part of the retained changes.

## Benchmark Method

The benchmark was `benchmarking/production-flight.mjs`, driven through `benchmarking/compare-cpu.mjs`.

Important controls:

- Production bundles were generated before each comparison.
- Runs were warmed before measurement.
- Node was pinned to the same two P-cores with `taskset -c 2,3`.
- Tests used 4, 8 and 16 players.
- Each scenario ran for 1,800 authoritative ticks.
- Scenarios were `convoy`, `spread`, `contact` and `modules`.
- Physics-changing work used `--diverge`, which applies the same repeat-specific perturbation to every variant and compares workload statistics instead of requiring identical hashes.
- Results were compared both as total CPU and as CPU normalized by the number of simulated entities.

The exact-hash rule was useful for protocol-preserving microchanges, but it rejected useful physics changes because collision trajectories are chaotic. A tiny numerical difference can produce a different later collision while retaining the same workload class. The diverging-run method made those changes measurable.

For local investigation, three extra tools were used:

- V8 CPU profiles with `node --cpu-prof`.
- Allocation sampling with the Inspector `HeapProfiler`.
- A small in-process interleaved A/B harness, which ran variants alternately in the same process to reduce CPU-frequency and background-thread noise.

The interleaved harness was especially useful because process CPU includes V8 background work and JIT activity, while a phase timer mainly measures the main simulation thread.

## What the Profiles Showed

The current 4-player contact profile divided approximately as follows before the final allocation reductions:

- Replication and snapshot preparation: about 27-30% of the tick.
- Collision orchestration and physics: about 45-50%.
- Region synchronization: about 10-14% depending on scenario.
- Entity update work: about 10-14%.
- Garbage collection: about 10-14% of sampled CPU time.

Allocation sampling was more informative than a simple heap-size graph. In one 4-player contact run, roughly 280 MB of allocations occurred under the tick loop even though only a small amount survived at the end. That means the important problem was allocation turnover, not retained memory.

The largest allocation callers were:

- `updateEntities` and `GameObject.update`.
- `localMovement` iterators and vector helpers.
- Craft hitbox construction.
- Collision spatial queries and TOI work.
- Replication module-state inspection.
- Region generation when new asteroids entered the active area.

A retained-memory sample showed only a few MB under the tick path. This confirmed that increasing the server memory tier would not directly solve the CPU cost: most of the cost was short-lived garbage.

## V8 Numeric Field Representations

V8 stores object fields in different representations. The trace output uses labels that are useful when reading `--trace-generalization` output:

- `s`: small integer representation.
- `d`: unboxed double representation.
- `t`: tagged representation, which can point to a HeapNumber.

Several Planck body fields were declared only with TypeScript types and were therefore initially `undefined` at runtime:

```ts
m_invMass: number;
m_invI: number;
m_angularVelocity: number;
```

The constructor later assigned numbers. V8 had already seen an undefined/tagged field representation and generalized the field to tagged storage. Repeated writes of changing doubles could then require HeapNumber objects.

They were changed to numeric initializers at declaration time:

```ts
m_invMass = 0;
m_invI = 0;
m_angularVelocity = 0;
```

The constructor assignments became unnecessary. This gives V8 a numeric field representation from object construction and avoids a class of boxed-double writes. The same principle was checked against trace output rather than applied blindly: fields that are genuinely optional or polymorphic were not forced to numeric values.

This is why initial values matter even when TypeScript's static type says `number`: TypeScript annotations disappear, while V8 observes the runtime initialization history.

## Why Plain For Loops Won

Several existing loops used `forEach`, `map`, spread, or iterator-based `for...of` forms. The issue was not that these constructs are always slow. The issue was that some of them created a callback or iterator in a very hot path, and one callback captured a reassigned local variable.

### The update loop closure

`updateEntities` originally used a callback over every scheduled entity. Inside that callback, `elapsed` was reassigned while timed input transitions were processed. That gave V8 a captured execution context per callback invocation and caused short-lived allocations for the hot update path.

The loop was changed to indexed loops:

```ts
for (let substep = 0; substep < updateTiers.visible.substeps; substep++) {
  for (let index = 0; index < scheduled.length; index++) {
    const { entity, tier, step } = scheduled[index];
    // ... elapsed is local to this loop iteration
  }
}
```

The behavior stayed the same: the loop still preserves timed input edges and the same substep schedule. The allocation profile changed substantially. Across comparable contact runs, tick-loop allocations fell approximately from 328 MB to 272 MB.

### Control and craft loops

`controlShip` used nested `forEach` calls over ship segments and module controls. It now uses indexed loops. This avoids creating a callback for every segment and makes the hot shape tests direct:

```ts
for (let index = 0; index < segments.length; index++) {
  const segment = segments[index];
  for (let control = 0; control < moduleControls.length; control++) {
    // test the module type directly
  }
}
```

`Craft.mounts` also changed from spreading mount arrays into a new array to indexed pushes. The output remains a new mount list, but it avoids iterator/spread machinery and makes the allocation explicit.

`Craft.update` previously built `filter`/`map` arrays on every update merely to discover whether anything was broken. It now counts broken mounts, hulls, intact hulls and core hulls in one pass. The expensive fracture/filter path only runs when the counts show that something actually changed.

### Collision pose capture

`capturePoses` now accepts the entity `Map` and uses `Map.forEach` instead of calling `.values()` and creating an iterator. The caller already owns a map, so this avoids a temporary iterator without changing the stored pose data.

### What was not changed blindly

The codebase contains a build plugin that rewrites some collection calls for the client build, so collection semantics matter. A `Map.forEach` cannot safely be treated like an array `.forEach` in shared code. Every loop change was checked against the plugin and the tests.

## Lazy Asteroid Geometry

Procedural asteroid construction was a major allocation source when a region first entered the active world. The constructor used to generate all asteroid segments immediately, even though most rocks never collided or were mined during the session.

The retained design stores the immutable inputs needed to cut the asteroid and defers `segmentsOf(...)` until segments are actually requested. Collision broadphase measurement uses an extent derived from the procedural outline without materializing the segment list. Locked geometry records that the eventual cut is fixed, so waking the asteroid can still use the same geometry cache.

This required an important replication fix. Checking:

```ts
entity.segments?.some(({ health, maxHealth }) => ...)
```

forces the lazy getter to cut the asteroid. Replication now uses the non-materializing `damaged` query instead. Untouched rocks remain procedural and do not pay the segment allocation cost.

This change was validated against collision, snapshot, rendering, region and simulation tests. It also reduced region-sync allocation work, especially in the contact scenario.

## Collision and Physics Simplifications

The collision changes were kept deliberately local:

- Parked bodies remain outside the physics broadphase until they need waking.
- Ballistic membership is tracked with a transition-aware record flag, avoiding redundant `WeakSet.add`/`delete` operations for every body on every step.
- Existing body records are looked up once per step and reused while stale-body cleanup is only performed when the live count differs.
- `capturePoses` reuses stored vectors.
- The TOI separation prefilter avoids `Math.hypot` in a hot path and uses explicit square roots. This is a small change, but it removes variadic math calls from repeated conservative rejection checks.
- The already-existing exact TOI and parked-body behavior was preserved; no new physics approximation was introduced in this pass.

The collision code remains large because it owns body lifecycle, broadphase preparation, deferred geometry, parking, fixture reuse and contact effects. Splitting it mechanically would increase interfaces and cache invalidation risks, so the refactoring work stayed at hot local boundaries instead of creating pass-through modules.

## Replication Investigation

Replication profiling confirmed that it is expensive, especially in `replicateEntity`, `readModules`, hull-health calculation and JSON encoding. The existing JSON fragment-sharing encoder was retained because it provides a measurable benefit without changing the object contract.

A new binary format was investigated in depth. The prototype used:

- A compact header.
- Entity IDs and flags.
- Separate motion fields.
- JSON state payloads for changed state.
- Client-side reconstruction and merging.

It failed for two reasons:

1. Using f64 motion fields made packets much larger and increased CPU.
2. Using f32 motion fields reduced size, but still made 4-player CPU roughly 8-15% worse than the existing path because the server still performed state preparation and then performed an additional binary encoding pass.

The prototype also temporarily broke direct replication object APIs and snapshot tests. It was removed entirely rather than left dormant or partially deployed. The current live client does not opt into it.

The conclusion is that a useful binary protocol must avoid JSON state construction entirely and use a schema-coded state representation. Merely wrapping the existing JSON-oriented preparation in a binary envelope is extra work, not a simplification.

## Measured Outcome

Against the pass-2 baseline, using four repeats, diverging seeded runs and two pinned P-cores:

| Players | Total CPU reduction | Entity-normalized reduction |
| ------- | ------------------: | --------------------------: |
| 4       |                7.3% |                        7.5% |
| 8       |               11.3% |                       11.1% |
| 16      |                9.4% |                        9.4% |

The first performance pass had already reduced CPU by roughly 50% against the original baseline. These results are an additional improvement over that already-optimized state, not a replacement for it.

## Validation

The retained tree was validated with:

- `npm test`
- `npm run lint`
- `npm run build`
- `npx tsc --noEmit`
- 4-, 8- and 16-player production-flight comparisons
- Collision, prediction, snapshot and rendering tests

One full-suite prediction run showed a timing-sensitive failure, but the isolated prediction test passed immediately afterward. The full suite passed before the final rejected GC candidate; after reverting that candidate, snapshots, lint and typecheck passed again.

## Practical Next Target

The largest remaining measured costs are:

- Collision query and TOI work.
- `readModules` and repeated craft-derived getters during replication.
- `localMovement` and entity update traversal.
- Region entity creation when new areas enter the active radius.

The next replication attempt should use a fixed schema and write directly into a reusable byte buffer. It should not create JSON state first. Any such change needs an independent object-level oracle and a real client decode/reconciliation test before it is benchmarked.

The follow-up fixed-schema binary implementation and its CPU result are documented in [CPU follow-up: binary-only networking and snapshot cadence](./performance-cpu-followup-2026-09-29.md).
