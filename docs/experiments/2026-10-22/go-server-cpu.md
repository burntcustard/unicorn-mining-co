# Go server CPU — October 22, 2026

The retained changes use **28.15% less process CPU** across the existing
16-case session matrix at 3,000 measured ticks. This is **1.392× throughput**
for that aggregate, below the requested overall 50% improvement. Every case
improves, but the equal-case mean CPU reduction is only **12.48%**.

The existing 32-player module workload reaches **51.39% less CPU** over 6,000
measured ticks. That sustained heavy case clears 50%; it does not establish a
50% saving across ordinary flight, combat, transport, or a live player mix.

The comparison starts from clean commit
`5cfd246c76a99d7f202bcf8e05eaeaa148316421`, including all earlier optimizations.
Earlier investigations' savings are not counted again. No deployment was made.

## Session measurements

Both executables use Go 1.27.1, `CGO_ENABLED=0`, `GOEXPERIMENT=simd`,
`GOAMD64=v1`, `GOMAXPROCS=2`, and affinity to physical cores 0 and 1 of the
AMD Ryzen 7 5800X3D. Both use **GOGC=200**, matching the checked-in Fly
configuration. Standalone startup and the Docker image still default to 800;
the benchmark documentation previously conflated those settings.
The host governor reports `powersave`; it was recorded and left unchanged.

Each cell is the median of five alternating before/after process runs,
with 120 warmup ticks followed by 3,000 measured ticks. CPU is process user plus
system time, including GC, divided by measured ticks. Setup, warmup, compilation,
and profile collection are excluded from these timing results.

| Players | Workload | Before CPU ms/tick | After CPU ms/tick | CPU saved |
| ------- | -------- | -----------------: | ----------------: | --------: |
| 4       | convoy   |           0.093619 |          0.086749 |     7.34% |
| 4       | spread   |           0.127900 |          0.119610 |     6.48% |
| 4       | contact  |           0.066430 |          0.060943 |     8.26% |
| 4       | module   |           0.226112 |          0.192788 |    14.74% |
| 8       | convoy   |           0.168232 |          0.157842 |     6.18% |
| 8       | spread   |           0.250927 |          0.234089 |     6.71% |
| 8       | contact  |           0.113366 |          0.103467 |     8.73% |
| 8       | module   |           0.430906 |          0.347483 |    19.36% |
| 16      | convoy   |           0.337895 |          0.316203 |     6.42% |
| 16      | spread   |           0.417564 |          0.396523 |     5.04% |
| 16      | contact  |           0.208077 |          0.188611 |     9.35% |
| 16      | module   |           1.164852 |          0.816999 |    29.86% |
| 32      | convoy   |           0.702299 |          0.645253 |     8.12% |
| 32      | spread   |           0.609165 |          0.573417 |     5.87% |
| 32      | contact  |           0.406651 |          0.366317 |     9.92% |
| 32      | module   |           4.088690 |          2.156864 |    47.25% |

The aggregate is `1 - sum(after case medians) / sum(before case medians)`.
Equal measured tick counts give more CPU weight to expensive cases. The
equal-case mean speedup is 1.168×; neither statistic forecasts a production
workload mixture. A paired bootstrap with 10,000 resamples gives a 95% interval
of **28.02–28.33%** for the aggregate CPU reduction on this host. It measures
repeat variability, not uncertainty across hardware or live encounters.

All 80 before/after pairs match **exactly** on final ship states, contact and
event counts, entities, packet counts, encoded-byte totals, and the separately
recorded near-zero collision counts. This is stronger than the runner's motion
tolerance. The timed session comparison checks summary outcomes, rather than
every intermediate packet's bytes. The full integration/parity suite supplies
separate protocol and shared-simulation coverage.

[Raw session captures](../../../benchmarking/experiments/2026-10-22/go-cpu/results/acceptance-3000.json.gz)
and [analysis](../../../benchmarking/experiments/2026-10-22/go-cpu/results/acceptance-3000-summary.json)
retain CPU, elapsed percentiles, allocations, memory, outcomes, and binary hashes.

## Sustained recovery and memory

Three additional alternating pairs extend the same 32-player module case to
6,000 measured ticks. No player count or gameplay capability was added.
Before CPU is **6.175444 ms/tick** and after CPU is **3.002076 ms/tick**:
**51.39% less CPU**, or **2.057× throughput**. All compared outcomes again match
exactly. The workload keeps adding its existing drilling targets, so it becomes
more expensive with duration; these numbers are not steady-state idle costs.

[Sustained captures](../../../benchmarking/experiments/2026-10-22/go-cpu/results/acceptance-6000.json.gz)
and [analysis](../../../benchmarking/experiments/2026-10-22/go-cpu/results/acceptance-6000-summary.json).

At 3,000 ticks, the 32-player module case's median elapsed p95 falls from
**17.10 to 4.02 ms**, and p99 from **31.89 to 5.97 ms**. Those are elapsed
processing times, distinct from CPU or network latency.
Median peak RSS is **107.95 → 108.60 MiB**, including setup. Allocation rises
slightly: **369,955 → 379,423 bytes/tick** and **3,160 → 3,174 objects/tick**.
The recovery obstacle list and cached bounds exchange a little memory for much
less projection work. Other module cases also allocate slightly more; this
change is not an allocation-reduction claim.

## Retained implementation

Overlap recovery originally projected distant fixture pairs while finding a
translation that frees a deeply embedded compound body. A separate 3,000-tick,
32-player module profile attributed 6.61 of 12.69 sampled CPU seconds to recovery,
about 52%. Conservative spatial rejection was the main remaining opportunity.

The Go recovery path now rejects whole distant bodies and individual fixture
pairs using enclosing circles before projecting vertices. Polygon bounds include
the miter produced by offset face slabs, including acute corners. Circle bounds
cover the existing 16-axis approximation. Ordinary rounded-shape bounds alone
would be insufficient for this search.

Fixture bounds reuse the body's existing pose revision, and slop changes
invalidate the radius. New fixtures start with empty caches. Very large world
coordinates retain the original relative projection checks, avoiding precision
loss from subtracting separately translated local centers. Cached numeric data
sits after the fixture's pointer-bearing fields. Exact duplicate escape
directions are searched once, preserving the first direction and tie rule.

The original first-ray bound, neighboring obstacles, full compound hitboxes,
slab tests, clearance, and position-only recovery remain. The matching TypeScript
file still supplies the original search as a shared-behavior reference. This
pass changes Go's work avoidance and storage, rather than the numerical rules
that the client must reproduce.

A checkpoint profile after body rejection attributes 1.02 of 6.74 sampled CPU
seconds to recovery, about 15%. That is approximately 85% less sampled CPU under
recovery, while total sampled CPU falls about 47%. These diagnostic profiles use
GOGC=800 and different checkpoint source; the controlled GC-200 tables above
determine the final reported savings.

The larger recovery change clears the requested greater-than-1% retention
threshold. Other retained changes are small: reuse an already validated collision
record, copy ordered-map values into existing buffers without callbacks, avoid
repeated module-data lookups, and read large immutable module specs by pointer.
Each of those implementation changes fits within the small-change allowance.

The production PGO profile is refreshed from separate 32-player convoy, spread,
contact, and module runs plus normal/dense pirate combat. The old profile had
only 0.97 sampled CPU seconds and predated current recovery/NPC code. An isolated
eight-case screen with identical source measured roughly 2–4% lower CPU with the
refreshed profile. It is a benchmark-derived profile, not a live Fly capture.

## Combat and transport

Five alternating pairs of the existing 9,000-tick pirate benchmark use the same
GC-200, two-core defaults and final executables. Aggregate combat CPU decreases
**4.66%**. All recorded asteroid counts, firing/fighting fractions, speed,
field coverage, maximum separation, and outgoing-byte metrics match.

| Combat case | Before µs CPU/tick | After µs CPU/tick | CPU saved |
| ----------- | -----------------: | ----------------: | --------: |
| open        |             26.119 |            24.348 |     6.78% |
| normal      |             54.452 |            51.625 |     5.19% |
| dense       |             73.067 |            69.746 |     4.55% |
| normal-fast |             58.141 |            55.528 |     4.49% |
| dense-fast  |            100.315 |            96.290 |     4.01% |

[Combat samples](../../../benchmarking/experiments/2026-10-22/go-cpu/results/pirate.json.gz).

The real loopback TCP game harness runs three alternating pairs at each existing
4/8/16/32-client idle/flight case: 120 warmup ticks and 180 measured ticks at
30 Hz. Go server processes use cores 0/1, GOMAXPROCS=2, and GOGC=200; the Node
clients run on cores 2–15. Aggregate median CPU decreases **3.63%**.

| Clients | Activity | Before CPU ms/tick | After CPU ms/tick | CPU saved |
| ------- | -------- | -----------------: | ----------------: | --------: |
| 4       | idle     |           0.413383 |          0.397322 |     3.89% |
| 4       | flight   |           0.424494 |          0.417639 |     1.61% |
| 8       | idle     |           0.557256 |          0.555761 |     0.27% |
| 8       | flight   |           0.608928 |          0.562511 |     7.62% |
| 16      | idle     |           0.904000 |          0.874411 |     3.27% |
| 16      | flight   |           0.956583 |          0.923589 |     3.45% |
| 32      | idle     |           1.496656 |          1.502111 |    -0.36% |
| 32      | flight   |           1.817644 |          1.685311 |     7.28% |

All 48 processes complete the runner's snapshot ordering, input acknowledgment,
and rate checks. Minimum per-client snapshot/input rate across either variant is
29.83 Hz. The largest after snapshot gap is 36.24 ms, and the largest input
acknowledgment delay is 68.66 ms. These short paced windows include socket,
timer, scheduler, and GC costs; the 32-client idle result is a small measured
regression. They do not establish a consistent reduction in every TCP case.
Connection timing can change flight trajectories, so TCP byte totals are not
asserted equal.

The original client benchmark rejected ordinary `sounds` control frames because
it expected every control to be a welcome message, then obscured the assertion
with a cleanup error. The corrected runner validates decoded controls after
welcome, records their types/bytes separately, and preserves snapshot and
acknowledgment checks. No measured-window control frames occurred in the final
capture. The incomplete earlier run is excluded.

[TCP captures](../../../benchmarking/experiments/2026-10-22/go-cpu/results/transport.json.gz)
and [analysis](../../../benchmarking/experiments/2026-10-22/go-cpu/results/transport-summary.json).

## Experiments not retained

Reusing boxed vector and numeric capture storage removed allocations, but did
not justify its extra ownership/type handling. The combined eight-case screen
saved only **0.50% aggregate CPU**, with regressions in several cases. For example,
32-player module allocations fell from about 2,780 to 2,157 per tick while CPU
fell only 0.99%. That is a useful distinction between allocation counts and
actual CPU. The prototype and raw samples are preserved for future work; the
production encoder retains its existing value representation and wire contract.

Early circle caches used a temporary fixture map. A profile showed that its
lookups had become a new hotspot, so the retained version uses fixture-owned
storage. Body-centered circles were also too loose for compound asteroids;
fixture-centered bounds and body rejection improved the complete path.

The intermediate body-rejection screen overlapped a short test run and is
diagnostic only. Early GOGC=800 captures, including a complete 3,000-tick matrix,
are also kept separately. Final claims use the clean, matched CGO-0/GC-200
executables and captures above.

## Earlier experiments reviewed

| Investigation                                                                                                                                                                                              | Relevant result and decision for this pass                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [September archive](../../../benchmarking/archive/README.md)                                                                                                                                               | Reviewed its CPU/physics report catalog and retained/rejected findings: lazy geometry, persistent movement/replication buffers, iteration, numeric representations, collision caches, and binary networking. V8-specific representation findings do not directly transfer to Go. |
| [October 1 Go CPU work](../2026-10-01/go-server-cpu-comparison-2026-10-01-followup.md)                                                                                                                     | Already includes GC tuning, scalar fast paths, collision caches, replication SIMD, and PGO. These are the starting implementation, not new savings.                                                                                                                              |
| [Precision](../2026-10-01/go-server-precision-simd-2026-10-01.md), [packed physics](../2026-10-01/go-server-packed-physics-2026-10-01.md), [solver](../2026-10-01/go-server-solver-redesign-2026-10-01.md) | Whole-session packing/float32/SIMD gains were often small or absent; broader solver grouping is still a distinct opportunity. Current profiles favor avoiding recovery work first. Float64 arithmetic, solver settings, and runtime-gated SIMD remain.                           |
| [October 2 networking](../2026-10-02/go-network-multicore-2026-10-02.md)                                                                                                                                   | Ordered inbox draining, contiguous frames, and buffer ownership already exist. The rejected single-CPU production restriction is not reinstated.                                                                                                                                 |
| [October 18 recovery](../2026-10-18/performance-fixes-2026-10-18.md)                                                                                                                                       | The first-ray/disk pruning fixed a larger regression but left substantial projection cost. This pass extends that algorithm with conservative bounds.                                                                                                                            |
| [October 20 combat](../2026-10-20/pirate-cpu.md), [maneuvers](../2026-10-20/npc-maneuvers.md), [clearance](../2026-10-20/npc-clearance.md)                                                                 | Forecast sharing, pruning, circle navigation, and snapshot caches already help. Slower decisions and removing clearance changed pursuit quality or increased CPU. Neither is used here.                                                                                          |
| [October 21 collection](../2026-10-21/pirate-collection-cpu.md) and [simplification](../2026-10-21/pirate-collection-simplification.md)                                                                    | Shared forecasts, ship-frame contacts, conservative circles, and lower-bound pruning already exist. Collection behavior and its decision cadence are unchanged.                                                                                                                  |

## Primary-source research

The research searched the [Go organization](https://github.com/orgs/golang/repositories?type=all)
broadly, then examined the performance-relevant compiler/runtime, documentation,
measurement, tooling, proposal, and supplementary-library material. A library
or compiler change was treated as a hypothesis for this workload, not a promised
whole-server saving.

| Source                                                                                                                                                                                                                                                                                                                                      | Application here                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Go diagnostics](https://go.dev/doc/diagnostics), [profiling](https://go.dev/blog/pprof), [wiki](https://github.com/golang/wiki/blob/master/Performance.md)                                                                                                                                                                                 | Identify expensive repeated work and keep profiling separate from acceptance timing.                                                                                                                                                                                                                                      |
| [golang/perf and benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat), [Sweet](https://github.com/golang/benchmarks/blob/master/sweet/README.md)                                                                                                                                                                                  | Repeated paired measurements and complete workloads matter more than an isolated kernel result. Existing session/transport runners remain the acceptance tools.                                                                                                                                                           |
| [PGO guidance](https://go.dev/doc/pgo), [compiler pipeline](https://github.com/golang/go/blob/master/src/cmd/compile/README.md)                                                                                                                                                                                                             | Representative profiles and source stability informed the profile refresh. Changes are verified on separate timing runs.                                                                                                                                                                                                  |
| [GC guide](https://go.dev/doc/gc-guide), [runtime](https://github.com/golang/go/blob/master/src/runtime/HACKING.md), [container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs)                                                                                                                                           | GC exchanges CPU for memory; parallelism and CPU-time quota are different constraints. Both variants receive identical settings.                                                                                                                                                                                          |
| [Go 1.27 notes](https://go.dev/doc/go1.27), [returned-struct issue](https://github.com/golang/go/issues/80980)                                                                                                                                                                                                                              | Read-only large-spec copies are worth checking. No custom compiler patch or unverified toolchain upgrade is used.                                                                                                                                                                                                         |
| [golang/tools](https://github.com/golang/tools), [field alignment](https://github.com/golang/tools/blob/master/go/analysis/passes/fieldalignment/fieldalignment.go)                                                                                                                                                                         | Layout changes require measurement; pointer scan extent and false sharing matter. No broad automatic struct reorder is applied.                                                                                                                                                                                           |
| [SIMD proposal](https://github.com/golang/go/issues/73787), [proposals](https://github.com/golang/proposal), [experimental packages](https://github.com/golang/exp), [sys](https://github.com/golang/sys), [net](https://github.com/golang/net)                                                                                             | Existing runtime-gated SIMD remains. Replacing APIs or widening arithmetic alone does not remove the profiled search/bookkeeping work.                                                                                                                                                                                    |
| [Centrifuge Go server](https://github.com/centrifugal/centrifuge), [TypeScript client](https://github.com/centrifugal/centrifuge-js/blob/master/src/centrifuge.ts), [performance study](https://centrifugal.dev/blog/2024/08/19/optimizing-websocket-compression)                                                                           | Shared prepared payloads avoid repeated work. This game already shares encoded entity fragments; per-player acknowledgments and baselines limit whole-packet sharing. That transfer assessment is an inference, not a benchmark of Centrifugo here.                                                                       |
| [Nakama Go server](https://github.com/heroiclabs/nakama), [TypeScript client](https://github.com/heroiclabs/nakama-js/blob/master/packages/nakama-js/client.ts), [authoritative loop](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/), [benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/) | Fixed-tick authoritative ownership and workload-specific measurements are relevant. Its published message/backend workloads are not measurements of this game's compound physics.                                                                                                                                         |
| [Grafana TypeScript frontend](https://github.com/grafana/grafana/blob/main/packages/grafana-runtime/src/services/live.ts), [Go Live service](https://github.com/grafana/grafana/blob/main/pkg/services/live/live.go), [Live design](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-grafana-live/)                             | A complete TypeScript/Go application uses multiplexed WebSocket subscriptions. Our single connection already carries control and snapshots; adding connections or adopting its softer delivery timing would not address the profiled simulation CPU. This is an architectural comparison, not a Grafana performance test. |

## Validation, size, and limits

The production build passes before and after. All **68 Node checks** and every
Go package test pass, including shared simulation and protocol integration.
The final 1,000-scene exhaustive recovery oracle passes three recovery steps per
scene, moving/rotating an obstacle between steps. It covers compound fixtures,
circles, acute polygons, large margins, distant geometry, and large coordinates.
Focused permanent tests cover offset-corner enclosure, pose changes, slop changes,
and the large-coordinate fallback. Lint, changed-file Go formatting, and
`git diff --check` pass.

The focused networking race check also passes. The first sandboxed Node run
encountered process/socket EPERM errors and left a test waiting; only that owned
run and its descendants were stopped. The complete permission-enabled rerun
passed. Those validation runs were outside the acceptance CPU measurements.

All **14 client resources are byte-identical** to the baseline. No FPS reduction
is introduced through a client-code change. The stripped Go executable grows
from **13,365,408 to 13,537,440 bytes** (+172,032, about 1.29%); deterministic
gzip level 1 grows from **6,169,287 to 6,255,428 bytes** (+86,141). The larger
PGO profile enables more compiler optimization and contributes to binary growth.

The session/combat benchmark defaults now select the first two available physical
cores and use GOMAXPROCS=2/GOGC=200 for both variants. Existing affinity, scheduler, GC,
player, workload, duration, and repetition overrides remain. Four/eight-core
experiments can set affinity and GOMAXPROCS explicitly; application scheduling
remains automatic. No 64-player case, gameplay tuning change, dependency, protocol
field, or production logging capability was added.

Two-core affinity does not emulate Fly's burst balance or throttling. Fly
documents shared CPU time quotas separately from the number of vCPUs.
These are local CPU results, not measurements of a deployed Machine, SQLite
writes, proxy/TLS, Internet latency, or a particular live player mixture.
[Fly CPU documentation](https://docs.fly.io/machines/cpu-performance).

Reproduction commands, profiles, source snapshots, hashes, raw samples, and
rejected prototype evidence are in the
[evidence archive](../../../benchmarking/experiments/2026-10-22/go-cpu/README.md).
