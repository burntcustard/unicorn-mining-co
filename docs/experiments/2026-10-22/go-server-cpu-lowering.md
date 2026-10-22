# Go compiler and CPU investigation — October 22, 2026

The subsequent [transport investigation](go-server-cpu-transport.md) achieves
24.23% additional CPU savings in the complete TCP matrix. The figures below
describe this earlier checkpoint and its separate simulation/combat measurements.

This follow-up starts from the optimized, uncommitted server produced by the
[preceding investigation](go-server-cpu.md). Its earlier savings are **not**
counted again. The retained changes save **4.33% additional process CPU** across
the existing session matrix and **2.57%** in pirate combat. Real TCP establishes
no CPU improvement. The requested additional **20% remains unmet**.

## What executes on the CPU

I inspected the installed Go 1.27.1 compiler, its AMD64 SSA lowering rules,
inlining defaults, actual benchmark executable disassembly, sampled CPU profiles,
and inherited hardware counters on this Ryzen 7 5800X3D. Compiler flags alone
were also tested, including deliberately unsafe bounds-check removal as a
**diagnostic ceiling**, never a production setting.

Go's compiler transforms typed code through its intermediate representation and
SSA, performs optimizations and register allocation, and emits machine code.
PGO changes some inlining and devirtualization decisions. See the compiler's
[pipeline description](https://github.com/golang/go/blob/go1.27.1/src/cmd/compile/README.md)
and [SSA documentation](https://github.com/golang/go/blob/go1.27.1/src/cmd/compile/internal/ssa/README.md).
The assembler guide explains that Go assembly is partly abstract; the retained
instruction observations come from disassembling the executable, as recommended
by the [Go assembler guide](https://go.dev/doc/asm).

Specific findings that shaped the changes:

- The original recovery slab clip contains **two `DIVSD` and eight `MINSD`**
  instructions, plus `POR`/`PXOR` operations implementing Go's IEEE floating-point
  min/max behavior. Replacing `min` with an arbitrary branch is not universally
  equivalent for NaNs and signed zero. The retained specialization applies only
  when every slab strictly contains the origin: the entry cannot influence the
  interval union starting at zero. Its compiled loop uses **one `DIVSD` and no
  `MINSD`** per nonparallel slab. The general clip retains its original arithmetic.
- The first ray already clips each slab while preparing it. Its final interval
  is reused instead of running the same divisions a second time.
- Cached immutable entity lists let read-only passes traverse contiguous entity
  interfaces directly. This removes repeated callback calls and list copies;
  entity methods and their interface checks still execute. Iterations that add
  or delete entities retain the JavaScript Map-compatible iterator.
- The generated update loop contains integer `DIVQ` for cadence calculations.
  Hoisting those divisions into tier-level flags did not yield a repeatable
  whole-session gain. A costly instruction matters only in proportion to how
  often it executes and what surrounds it.
- `GOAMD64=v3` emits fused instructions such as `VFMADD231SD` in the sine/cosine
  polynomial. It brought little additional benefit and changes floating-point
  rounding/hardware requirements. Production retains `GOAMD64=v1` and its existing
  runtime-gated SIMD. Native 386 execution, despite narrower pointers, used far
  more CPU; changing architecture was not a useful cache optimization.
- The original replication encoder has a large compiled body and duplicates
  its inlined acceptance closure across scalar/vector paths. Unifying those
  paths reduced apparent source duplication but did not improve CPU. Increasing
  or reducing inlining by intuition was similarly unhelpful.

The AMD-authored [Zen 3 optimization guide, publication 56665](https://docs.amd.com/v/u/en-US/56665)
([accessible PDF copy](https://www.lsferreira.net/public/knowledge-base/x86/upos/amd_zen3.pdf))
informed the focus on division, dependency chains and branch behavior. The guide
covers the Zen 3 family; its examples are not measurements of this exact desktop
CPU. The host's large L3 cache does not establish that every structure fits or
that every generic cache-miss event is an L3 miss.

## Retained changes

1. `OrderedMap.ReadValues` caches a read-only ordered list until mutation.
   Previously returned lists remain intact. Simulation, replication and collision
   passes share it where their iteration cannot mutate entity membership.
2. Recovery specializes origin-containing intervals, reuses the first ray's
   clip result, and abandons a direction once a connected subset already reaches
   the current best distance. This lower bound never substitutes for the full
   compound hitbox or ignores a potentially better escape.
3. Recovery uses linear direction deduplication for its small lists, an unstable
   interval sort where equal-entry ordering cannot affect union reach, and a
   padded square-root norm solely for conservative pruning. Hypot remains the
   fallback for extreme values; escape arithmetic and direction order remain.
4. Sine/cosine skips modulo wrapping when the angle is already within one turn.
   The polynomial, coefficients and operation order remain unchanged.
5. A separately trained PGO profile covers the four existing 32-player session
   workloads plus normal/dense pirate combat. Timing captures are separate from
   training, following [Go's PGO guidance](https://go.dev/doc/pgo).

No client source, wire contract, simulation cadence, input queue, solver iteration
count, transport implementation or deployment configuration changes in this
follow-up. No other-language dependency or unsafe compiler flag is retained.

## Measurement protocol and results

Both sides use Go 1.27.1, CGO disabled, the existing SIMD experiment,
`GOAMD64=v1`, `GOMAXPROCS=2`, `GOGC=200`, and affinity to distinct physical cores
0 and 1. The Node driver runs on cores 2–15. The existing 4/8/16/32-player
workloads run for 120 warmup and 3,000 measured ticks with five alternating
before/after pairs. CPU is measured process user plus system time per tick.
Compilation, tests and profiles do not run alongside acceptance measurements.

The complete session matrix uses **4.33% less CPU**
(1.045× aggregate throughput), with an equal-case mean reduction of
**3.39%**. The paired bootstrap 95% interval is
**4.11%–4.84%** on this host. It describes repeat
variation, not uncertainty across production hardware or workload mixtures.

| Players | Workload | Before CPU ms/tick | After CPU ms/tick | CPU saved |
| ------- | -------- | -----------------: | ----------------: | --------: |
| 4       | convoy   |           0.087307 |          0.084380 |     3.35% |
| 4       | spread   |           0.119277 |          0.114017 |     4.41% |
| 4       | contact  |           0.061836 |          0.060985 |     1.38% |
| 4       | module   |           0.192648 |          0.183048 |     4.98% |
| 8       | convoy   |           0.158057 |          0.154369 |     2.33% |
| 8       | spread   |           0.235171 |          0.223476 |     4.97% |
| 8       | contact  |           0.103446 |          0.102687 |     0.73% |
| 8       | module   |           0.346733 |          0.328278 |     5.32% |
| 16      | convoy   |           0.316600 |          0.308365 |     2.60% |
| 16      | spread   |           0.396554 |          0.375750 |     5.25% |
| 16      | contact  |           0.190269 |          0.190508 |    -0.13% |
| 16      | module   |           0.824327 |          0.771755 |     6.38% |
| 32      | convoy   |           0.645580 |          0.635079 |     1.63% |
| 32      | spread   |           0.576207 |          0.550648 |     4.44% |
| 32      | contact  |           0.367715 |          0.363495 |     1.15% |
| 32      | module   |           2.152740 |          2.034035 |     5.51% |

All **80 before/after pairs** match exactly on final ship states, contacts,
events, entities, packet counts, encoded-byte totals and near-zero collision
counts. These are compared summary outcomes, rather than byte-by-byte checks
of every intermediate packet. The independent integration/parity suite supplies
additional protocol and simulation coverage.

The sustained module case saves **5.94%**
(3.014449 → 2.835363 CPU ms/tick).
Pirate combat saves **2.57%** in aggregate; all recorded
activity/output metrics match exactly. The open case changes only 0.46%.

Real TCP establishes **no CPU improvement**: its aggregate point estimate is
**0.68% more CPU**, with substantial variation between individual
runs. Minimum snapshot rates remain about 29.995 Hz. Worst p95 input-acknowledgment
latencies remain around 66–67 ms; per-case differences are under 0.52 ms. These
are acknowledgments measured by the existing transport harness, not rendered
input-to-photon latency. There is no added queue, tick or replication delay.

[Raw session results](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/results/acceptance.json.gz),
[exact-outcome/CPU summary](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/results/acceptance-summary.json.gz),
[sustained results](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/results/sustained.json.gz),
[combat summary](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/results/pirate-summary.json.gz),
and [TCP summary](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/results/transport-summary.json.gz)
retain the sample details and limitations.

An identical-source old-versus-new PGO comparison is effectively neutral across
four 16/32-player spread/module cases. The refresh is retained as small profile
maintenance aligned with current call sites; no independent CPU saving is
attributed to it. A separate control compares no PGO with the fresh profile.
Network-package test executables require an explicit profile path; they do not
automatically discover the main server package's default profile. The archive
builder passes it explicitly.

A separate existing 32-player module case runs for 6,000 measured ticks with
three alternating pairs. The existing five pirate cases use 9,000 ticks and five
pairs. Paced real TCP uses 8 and 32 clients, idle and flight activity, three pairs,
120 warmup and 180 measured ticks. This adds no new player count or gameplay
benchmark capability. Local affinity does not reproduce Fly shared-host contention,
credits, quota throttling or its physical CPU.

## Hardware counters and profiles

The new Linux `benchmarking/tools/go-perf` wrapper reads inherited, user-mode PMU
counters around an **existing** executable. It records enabled/running time and
scaled values for cycles, retired instructions, branches, branch misses, generic
cache references and generic cache misses. Unsupported/denied counters are
reported explicitly. See [perf_event_open](https://man7.org/linux/man-pages/man2/perf_event_open.2.html).
The scope includes wrapper-thread overhead, child startup and warmup, unlike the
benchmark's measured-tick CPU window. These captures diagnose mechanisms; their
cycle counts are not acceptance CPU savings.

An early matched 32-player module diagnostic showed roughly 5.3% fewer retired
instructions and 12.0% fewer branch misses with cached lists and early interval
pruning. Generic cache misses barely changed. This supported reducing executed
work rather than claiming a cache-only fix. The final capture shows **5.62% fewer instructions**, **11.85% fewer branch
misses** and **6.51% fewer cycles** over its larger diagnostic scope. Generic
cache misses increase 0.62%; no cache-miss reduction is claimed. Source snapshots
and disassembly are retained separately.

The baseline 32-player module CPU profile assigns about 53% cumulative time to
collision stepping, 16% to overlap recovery, 13% to continuous collision solving,
26% to replication encoding and 9% to entity updates. These categories overlap.
A longer convoy profile exposes insertion-sort shifts, but replacing the sort
was slower. A real paced TCP profile spends about 47% of sampled CPU in syscall
wrappers; measured system CPU is a substantial fraction of total CPU. Optimizing
Go arithmetic alone cannot remove that kernel work.

## Rejected experiments

These are diagnostic screens, not independently additive gains. Raw captures
identify the exact comparison executable and whether outcome checks were relaxed.

| Experiment                                                                                           | Observation and decision                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full sort above a size threshold; sort reuse only when topology is unchanged                         | No useful gain; restored original adaptive insertion sort.                                                                                                                |
| Hoisted cadence divisions                                                                            | No useful whole-session gain; restored.                                                                                                                                   |
| One acceptance loop for scalar/SIMD replication                                                      | Slight regression; restored.                                                                                                                                              |
| Experimental new inliner                                                                             | No useful gain; disabled.                                                                                                                                                 |
| Smaller hot-inline budget                                                                            | Usually slower; restored compiler default.                                                                                                                                |
| PGO disabled                                                                                         | Roughly 2–3% slower in the screen; kept PGO.                                                                                                                              |
| Bounds checks disabled (`-B`)                                                                        | Only about 1–2% diagnostic improvement; never retained.                                                                                                                   |
| GOAMD64 v3 / FMA                                                                                     | About 0–2% in the screen; no ISA or rounding change retained.                                                                                                             |
| Native 386 / narrower pointers                                                                       | About 60–72% more CPU; rejected. A test-only overlay makes benchmark rusage arithmetic portable without production changes.                                               |
| Reordered slab min/max, direct blocked-point test, lazy replication membership IDs                   | Combined screen regressed about 1–4%; restored.                                                                                                                           |
| First-neighbor existential broad phase                                                               | No useful additional gain; restored.                                                                                                                                      |
| Contact-normal-first recovery                                                                        | Changed contacts, events and motion without improving over the retained ray order; rejected.                                                                              |
| Merge adjacent asteroid triangles into convex physics fixtures; map contacts back to original leaves | Extra helper and changed contact topology, little benefit in the expensive 32-player module case, regressions elsewhere; rejected. Original destructible fixtures remain. |
| Merge adjacent ship-hull fixtures, with original-leaf contact lookup                                 | Helped convoy and the 16-player module screen, but contact workloads used about 34–35% more CPU. Rejected; original hull fixtures remain.                                 |
| Immediate nonblocking socket writes                                                                  | Small/noisy gains and extra synchronization/allocation concerns; restored queued writer.                                                                                  |
| Cached callback plus raw nonblocking send syscall                                                    | About 5% in one 32-client flight screen; insufficient evidence/benefit for added platform-specific transport and latency complexity.                                      |
| Shared nonblocking writer with dedicated slow-client fallback                                        | Mostly 0–4%, only about 1% at 32-client flight; rejected.                                                                                                                 |

The fixture-merging prototype joins shared edges and checks convexity rather than
covering concave geometry with a convex hull. Nevertheless its performance did
not justify changing contact topology and porting that behavior to the client.
Its captures deliberately use report-only outcome comparison and establish no
behavioral parity.

An initial fixture-merging capture built the wrong test package. Its executable
reported no matching test, exposing a stale-result-file flaw in the paired
runner. That capture is marked **invalid** and contributes no result. The runner
now removes the destination before each execution and verifies player/workload/
tick metadata and finite CPU. The corrected prototype was rebuilt from the
network test package and rerun in full.

C/Rust leaf-kernel rewrites were considered but not benchmarked: Go's actual
[cgo transition](https://github.com/golang/go/blob/go1.27.1/src/runtime/cgocall.go)
adds runtime transitions that would need amortizing over a sufficiently large
batch. A language change alone supplies no demonstrated saving. Linux
[MSG_ZEROCOPY](https://www.kernel.org/doc/html/latest/networking/msg_zerocopy.html)
is a poor fit for these small packets; io_uring would require a much larger
transport/lifetime rewrite. Neither is claimed as a measured improvement.

## Correctness, resources and reproduction

- Production builds before and after pass.
- All **68 Node tests** and **all Go server packages** pass, including networking
  and shared client/server parity tests. Lint and targeted Go formatting checks pass.
- The exhaustive recovery oracle passes **1,000 generated scenes × three
  recovery steps**, with exact transforms. It exercises compound circles/polygons,
  acute triangles, distant obstacles, large world coordinates, varying collision
  margins and nonphysical fixtures. Moved/rotated obstacles test cache invalidation.
- Focused regression tests cover immutable ordered-map lists, conservative
  pruning lengths and specialized interval exits. The paired-runner stale-file
  guard also passes a manual missing-result check.
- Rebuilding both archived variants verifies their complete production-source
  and profile hashes. The starting hash is exactly the preceding investigation's
  final hash. The archived final-source recovery overlay passes independently.
- All **14 client resources are byte-identical**. No client FPS cost is introduced
  by client code or resource changes. No new browser FPS claim is made.
- Stripped server: **13,537,440 → 13,512,864 bytes** (−24,576).
  Gzip level 1: **6,255,428 → 6,245,814 bytes** (−9,614).
  PGO profile: **48,604 → 38,612 bytes**.

The [evidence archive and reproduction instructions](../../../benchmarking/experiments/2026-10-22/go-cpu-lowering/README.md)
retain source/profile overlays, raw data, disassembly, hardware counters, training
inputs, rejected prototype fragments, build identities, logs and resource hashes.
No deployment was made. The requested additional **20% remains unmet**.

The [previous report](go-server-cpu.md#primary-source-research) preserves
the broad Go organization and TypeScript/Go application research. This follow-up
concentrates on actual compiled instructions, runtime/kernel boundaries and
measured algorithm changes rather than assuming another framework or language
will be faster.
