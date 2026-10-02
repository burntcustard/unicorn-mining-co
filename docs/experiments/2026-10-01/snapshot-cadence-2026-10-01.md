# Snapshots at the simulation rate — 2026-10-01

Go and TypeScript now send ordinary snapshots after every 30 Hz simulation
update. Across three runs of each workload at 4, 8, 16 and 32 players, average
server CPU increases **10–15%** and encoded traffic increases **71–73%**.
All compared simulation outcomes remain identical. These measurements use the
current optimized server, following the [solver investigation](go-server-solver-redesign-2026-10-01.md).

## Behavior and simplification

Both sessions remove the division-by-two broadcast boundary. A normal tick sends
one current snapshot; a catch-up batch sends one snapshot after completing the
batch. Initial loads and dock/respawn responses still use their immediate paths.
The Go/TypeScript session parity test acknowledges the latest decoded sequence
instead of deriving it from half the simulation tick count.

Clients already measure snapshot intervals in simulation ticks, so there is no
client rate multiplier to remove. Interval tracking remains useful for delayed
packets, catch-up batches and sparse entity replication. Distant entities and
ballistic scenery retain their existing replication schedules. The client's
15 Hz active-sprite range refresh is independent of network timing.

The two-snapshot acknowledgement window and byte-buffer limits still bound slow
receivers. Full 30 Hz delivery requires acknowledgements within roughly 67 ms;
longer round trips or congestion reduce snapshot frequency. The existing slow-link
test keeps healthy clients current, limits the slow client's queue to two
snapshots, and verifies recovery after bandwidth returns.

## Results

CPU is process user plus system time per simulation tick. Each cell is the median
of three separate processes. The aggregate CPU figures average the four workload
medians; byte changes compare totals across four equally long workloads.

| Players | 15 Hz average CPU ms/tick | 30 Hz average CPU ms/tick | CPU increase | Encoded-byte increase |
| ------: | ------------------------: | ------------------------: | -----------: | --------------------: |
|       4 |                  0.081136 |                  0.091895 |      +13.26% |               +70.80% |
|       8 |                  0.138805 |                  0.157433 |      +13.42% |               +71.51% |
|      16 |                  0.295829 |                  0.339434 |      +14.74% |               +72.53% |
|      32 |                  0.764506 |                  0.843849 |      +10.38% |               +73.38% |

| Players | Workload | 15 Hz CPU ms/tick | 30 Hz CPU ms/tick | CPU increase | Encoded-byte increase |
| ------: | -------- | ----------------: | ----------------: | -----------: | --------------------: |
|       4 | convoy   |          0.044112 |          0.050199 |      +13.80% |               +44.16% |
|       4 | spread   |          0.055394 |          0.066616 |      +20.26% |               +35.36% |
|       4 | contact  |          0.032971 |          0.037649 |      +14.19% |               +83.40% |
|       4 | module   |          0.192068 |          0.213117 |      +10.96% |               +74.68% |
|       8 | convoy   |          0.090345 |          0.102967 |      +13.97% |               +50.66% |
|       8 | spread   |          0.107504 |          0.118249 |       +9.99% |               +37.76% |
|       8 | contact  |          0.058630 |          0.073627 |      +25.58% |               +87.73% |
|       8 | module   |          0.298739 |          0.334890 |      +12.10% |               +73.84% |
|      16 | convoy   |          0.183688 |          0.210183 |      +14.42% |               +58.84% |
|      16 | spread   |          0.227256 |          0.249649 |       +9.85% |               +42.45% |
|      16 | contact  |          0.114776 |          0.133419 |      +16.24% |               +87.71% |
|      16 | module   |          0.657598 |          0.764485 |      +16.25% |               +72.33% |
|      32 | convoy   |          0.326797 |          0.374585 |      +14.62% |               +60.45% |
|      32 | spread   |          0.662281 |          0.718683 |       +8.52% |               +40.64% |
|      32 | contact  |          0.232386 |          0.252836 |       +8.80% |               +87.74% |
|      32 | module   |          1.836560 |          2.029291 |      +10.49% |               +73.26% |

Every measured process sends exactly 1,500 snapshots per player before and 3,000
after. Contacts, consequential events, near-zero collisions, entity counts and
final ship states match exactly between versions and across repetitions. Encoded
bytes also repeat exactly within each version. More frequent state deltas explain
why doubling packet count increases byte totals by less than 100%.

## Method and reproduction

- AMD Ryzen 7 5800X3D; Node v26.8.2; Go 1.27.1 linux/amd64 with `GOEXPERIMENT=simd`.
- Identical `GOGC=800`, `GOMAXPROCS=2` and logical CPU affinity `0,1` for both versions.
- Seed 25, 120 warmup ticks, 3,000 measured ticks (100 simulated seconds), procedural regions enabled.
- Four workloads: convoy flight, spread-out turning flight, opposing contact pairs, and drilling with hatch/light transitions and replenished targets.
- Three runs per workload/player count/version: 48 baseline runs followed by the source change and 48 changed runs. No builds or test suites run concurrently with measurement.
- Separately compiled test executables; compilation, setup, warmup and artifact writing are outside timing. Runs advance as fast as possible.
- Real replication and binary serialization, with in-memory socket sinks and acknowledgements. OS WebSocket I/O, external clients, browser rendering and WAN delivery are excluded.

The baseline is commit `83f5fa42b962260a79ac145a9df7fc8904bd5635`. The measured
baseline executable SHA-256 is `4f2b3be61bd3df09667b46618e558ec448052d55a5eadf50328361df69fa1ab3`;
the changed executable is `55d8f3ccc63dfcb542cdab625403ea48a33ecce32b7bafef6e71e75948251e69`.
Raw [15 Hz results](../../../benchmarking/experiments/2026-10-01/snapshot-cadence/results/2026-10-01-snapshots-15hz.json.gz)
and [30 Hz results](../../../benchmarking/experiments/2026-10-01/snapshot-cadence/results/2026-10-01-snapshots-30hz.json.gz)
retain every CPU sample, allocation/memory measurement, latency tail, packet/byte
total and outcome. The runner now records the requested CPU affinity correctly.

Compile each source version with
`GOEXPERIMENT=simd go test -c -o /tmp/snapshots-VERSION ./internal/server`, then run:

```sh
GOEXPERIMENT=simd GOGC=800 GOMAXPROCS=2 CPUSET=0,1 \
  REPETITIONS=3 TICKS=3000 SESSION_SEED=25 \
  GO_SERVER_SIMD= GO_SERVER_MOTION_ROUNDING= GO_SERVER_COLLISION_NEIGHBORS= \
  node benchmarking/tools/go-cpu.mjs snapshots-VERSION /tmp/snapshots-VERSION
```

Use `VERSION=15hz` for the baseline source and `VERSION=30hz` for the changed
source. All requested player counts and workloads are the runner's defaults.
Choose the same allowed CPU pair on another host. Three repetitions and sequential
batches do not establish confidence intervals or remove possible host drift.
The CPU results quantify this workload's cost; live smoothness still needs play
testing on representative connections.

## Validation and resource sizes

Cadence tests cover every-tick inputs/snapshots, one send per catch-up batch,
immediate controls and bounded backpressure. The three-arrival-phase client test
improves from a maximum one-tick server-state lag to zero after packet delivery.

Production builds before and after, the complete `npm test` and `npm run test:go`
suites, and lint pass. Go/TypeScript session parity compares 748 decoded packets,
including timed input, reconnect, catch-up and backpressure. Lint reports the two
existing `no-new-array` warnings. Go formatting and formatting of every changed
file pass. Repository-wide `npm run format:check` flags six unchanged experiment
documents; those documents are outside this change.

The client entry remains 120,491 bytes / 52,997 gzip-level-1 bytes. Docked and sound
chunks remain 4,708 and 1,681 bytes. The Node server bundle shrinks from 105,848 /
45,408 to 105,795 / 45,386 bytes (raw / gzip level 1): **53 raw bytes and 22 gzip
bytes smaller**. The existing client entry-size warning remains.
