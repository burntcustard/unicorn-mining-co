# Additional Go server CPU reduction

The [report](../../../../docs/experiments/2026-10-22/go-server-cpu-transport.md)
explains the implementation, compiler/runtime investigation, measurements, and
limitations. This capture starts from the preceding optimized working tree;
its earlier gains are excluded.

- Complete TCP matrix: **24.23% less process CPU**, 23.59% equal-case mean;
  paired 95% repeat interval 22.42–25.97%. All eight 4/8/16/32-player idle/flight
  cases improve by more than 20%, with five alternating pairs per case.
- Simulation/replication matrix: essentially flat, 0.09% saving; 80 pairs exactly
  match gameplay outcomes, excluding the intentionally optional receipt metadata.
- Writer isolation with corrected receipts held constant: 5.32% less CPU.
- Delayed-receipt checks preserve cadence. The 250 ms delay capture saves only
  3.42% CPU; the primary result does not apply to every latency distribution.
- All 69 Node test files, Go packages, race checks, builds and lint pass.
  Fourteen client assets and the existing PGO input are unchanged.

`sources.json` identifies the before/after production source hashes, module
files, profile hashes, and common benchmark sources. `manifest.json` checksums
every archived artifact except itself. Profiles, hardware counters, and syscall
disassembly are diagnostics, separate from unprofiled acceptance measurements.

## Rebuild without changing the checkout

Run from the repository root with the installed dependencies and Go 1.27.1.
The builder uses source overlays, archived module files, and an explicit PGO
profile. It verifies source/profile hashes, handles newly added files, and
does not replace working files or reset Git state.

```sh
node benchmarking/experiments/2026-10-22/go-cpu-transport/build.ts before /tmp/tcp-before transport
node benchmarking/experiments/2026-10-22/go-cpu-transport/build.ts after /tmp/tcp-after transport
GAME=1 PLAYERS=32,4,8,16 ACTIVITIES=idle,flight REPETITIONS=5 PACED_TICKS=180 \
  GOMAXPROCS=2 GOGC=200 BENCH_CPU_AFFINITY=0,1 taskset -c 2-15 \
  node benchmarking/tools/websocket-transport-compare.ts \
  /tmp/tcp-before /tmp/tcp-after benchmarking/local/reproduced-tcp.json.gz

node benchmarking/experiments/2026-10-22/go-cpu-transport/build.ts before /tmp/session-before
node benchmarking/experiments/2026-10-22/go-cpu-transport/build.ts after /tmp/session-after
TICKS=3000 REPETITIONS=5 OUTCOME_COMPARISON=replication GOMAXPROCS=2 GOGC=200 \
  CPU_AFFINITY=0,1 node benchmarking/tools/go-cpu-paired.ts reproduced-session \
  /tmp/session-before /tmp/session-after
```

CPU affinity must name two available physical cores on another host. Go retains
automatic production scheduling. The common in-memory socket helper acknowledges
only new receipt requests, as the existing production client does. Byte equality
is excluded because the optional request field is deliberately omitted; states,
contacts, events, entities, packets, and near-zero collision counts match exactly.

Both session variants and both transport targets were rebuilt from this archive.
Snapshot tests and a short client-codec transport run pass on the reproduced
executables. The original executable hashes remain in the raw captures; debug
paths and explicit profile/module-file paths can change rebuilt binary hashes.

## Evidence map

- `results/acceptance-transport-final.json.gz` and `transport-summary.json.gz`:
  the complete 80-process acceptance capture and paired summary.
- `results/acceptance-session.json.gz` and its summary: 160 measured processes,
  including exact gameplay-outcome comparisons.
- `results/direct-isolation.json.gz`: corrected receipt behavior held constant.
- `results/delayed-transport.json.gz`: 16 processes with 250 ms receipt delay.
- `profiles/tcp-{before,after}.pprof`, `results/pmu-{before,after}.json.gz`, and
  `support/tcp-*-top.log`: separately instrumented CPU/counter/rusage evidence.
  Counter scope includes setup, warmup, the wrapper thread and inherited tasks;
  PMU events exclude kernel/hypervisor execution. Child rusage includes kernel
  CPU and reports Linux peak RSS in KiB. No cache event is labeled an L3 miss.
- `results/assembly/`: actual executable instructions. The fast callback reaches
  nonblocking `sendto`; ordinary queued writes retain Go's syscall transitions.
- `results/repository-review.json.gz`: all 61 Go repositories and the 58 available
  overview files/redirects read, with Git blob hashes. The report links inspected
  implementation sections across relevant compiler, runtime, geometry, caching,
  data layout, syscall, and measurement repositories, plus TypeScript/Go systems.
- `support/harness/`: the exact timing drivers and regression oracle; ordinary
  checks also run through `tests/integration/go-transport.test.ts`.
- `support/transport-oracle-final.log`: forced partial writes/headers, EAGAIN,
  EINTR, closed-peer errors, concurrent producers, control-frame ordering,
  receipt delays/jitter, and the race detector.
- `results/resources-*.json.gz`: sizes and SHA-256 for production resources.

## Exploratory captures

`acceptance-transport.json.gz` and `acceptance-transport-invalid-startup.json.gz`
are the same incomplete earlier capture, stopped by an incorrect startup
assertion. They are **excluded** from final acceptance. Only the `-final` capture
supplies the TCP result above. Its corrected driver validates packet order and
tick progression separately, including consecutive measured undelayed ticks.

`ack-transport.json.gz` and `ack-direct-transport.json.gz` are preliminary timing
screens. The first receipt implementation was incorrect under jitter; it was
replaced by the bounded allowance/probe implementation before final acceptance.

`bounds-invalid-stride.json.gz` is invalid. The corrected swept-bound prototype
also changed contacts and is not retained. `caches.json.gz` screens the combined
manifold/observer caches; it does not isolate their contributions. `pose.json.gz`
shows no reliable pose-version-cache gain. Source prototypes and generating
scripts are preserved in `patches/` and `support/`; none is enabled in production.
