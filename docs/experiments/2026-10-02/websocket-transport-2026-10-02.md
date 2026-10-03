# Go WebSocket transport — 2 October 2026

The [networking and runtime follow-up](go-network-runtime-2026-10-02.md) measures
the complete 30 Hz server and further improvements after this transport baseline.

The production transport now sends each WebSocket header and payload together
and avoids an extra allocation/copy when receiving an unfragmented message.
Every connection uses the same implementation at 4, 8, 16 and 32 players.
Frames are sent immediately: there is no player-count threshold, batching window,
extra tick of latency, or packet-size-dependent transport strategy.

## What was measured

The earlier Go/Node session comparison used in-memory sockets and measured game
simulation, replication and encoding. It omitted the actual transport. This
investigation isolates that omitted work with the production `server.Upgrade`,
writer queue, WebSocket framing and TCP connection over loopback.

The Go server and Node `ws` clients run in separate processes. Each exchange
sends one deterministic binary frame to every client. Each client verifies the
entire payload and strictly increasing sequence, then sends two separate masked
32-byte frames: an input and an acknowledgement. The server waits for all
acknowledgements before advancing. Every run validates all frames, including
warmup, without missing, duplicated, reordered or corrupted payloads.

The retained comparison uses five alternating before/after repetitions for each
of 16 cases: 4/8/16/32 clients; unpaced 128/2,048/8,192-byte payloads for 3,000
measured exchanges; and 2,048-byte payloads at 30 Hz for 150 measured exchanges.
Each case first completes 120 unpaced warmup exchanges. CPU is server-process
user plus system time from `getrusage`, normalized per exchange. Client CPU,
startup, connection upgrades and warmup are excluded. Allocation counts come
from `runtime.MemStats`; latency spans enqueue through the last acknowledgement.

Host: Intel Core Ultra X7 358H, Linux, Go 1.27.1 with `GOEXPERIMENT=simd`.
Both server executables use the same supplied production PGO profile, `GOGC=800`
and `GOMAXPROCS=2`. Server affinity is logical CPUs 0/1; the Node generator runs
on CPUs 2–15. Builds, tests and other benchmarks were serialized with timing.
Executable/harness hashes and every individual sample are saved in
[the full comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/four-counts.json.gz).

This is a synthetic transport workload. Its barrier, input cadence, loopback
latency and sleeping server differ from the game and Fly's proxy/VM. It measures
the real transport's costs but cannot establish a whole-game or whole-VM CPU
reduction, or the original Node/Go ratio on Fly.

## Implementation

Previously each outgoing frame used separate `conn.Write` calls for its header
and payload. `net.Buffers.WriteTo` now passes both together to TCP's `writev`
implementation. Headers and the two vector descriptors live on the socket and
are reused under the existing writer lock. This avoids allocating descriptors
per frame. Payload references are cleared after writing. See
[Go's `net.Buffers` documentation](https://pkg.go.dev/net#Buffers.WriteTo).

The queue still owns a copy of the outgoing payload, since callers reuse their
encoding buffer before asynchronous writes finish. Queue capacity, payload-byte
accounting, slow-client limits, the writer goroutine and ten-second write
deadline remain in force. Successful short writes are rejected rather than
silently truncating a frame.

On receive, fixed header, extended-length and mask bytes share a socket-owned
14-byte scratch area. Each frame still owns its payload. `ReadMessage` returns
that payload directly when the first data frame is final, while fragmented
messages retain assembly and control-frame handling. This avoids the previous
copy into a second message buffer and escaping header/mask allocations. No
buffer pool or shared payload lifetime was introduced.

## Results

Median CPU milliseconds per exchange; positive savings mean lower CPU.

| Clients | Payload bytes | Rate    | Before   | After    | CPU saving |
| ------- | ------------- | ------- | -------- | -------- | ---------- |
| 4       | 128           | Unpaced | 0.050516 | 0.046122 | 8.70%      |
| 4       | 2,048         | Unpaced | 0.065829 | 0.059157 | 10.14%     |
| 4       | 8,192         | Unpaced | 0.068777 | 0.063668 | 7.43%      |
| 4       | 2,048         | 30 Hz   | 0.768653 | 0.708087 | 7.88%      |
| 8       | 128           | Unpaced | 0.089288 | 0.080956 | 9.33%      |
| 8       | 2,048         | Unpaced | 0.101033 | 0.094756 | 6.21%      |
| 8       | 8,192         | Unpaced | 0.125783 | 0.113849 | 9.49%      |
| 8       | 2,048         | 30 Hz   | 1.037300 | 0.879107 | 15.25%     |
| 16      | 128           | Unpaced | 0.166703 | 0.147174 | 11.72%     |
| 16      | 2,048         | Unpaced | 0.193892 | 0.174431 | 10.04%     |
| 16      | 8,192         | Unpaced | 0.236470 | 0.215836 | 8.73%      |
| 16      | 2,048         | 30 Hz   | 1.331087 | 1.363193 | -2.41%     |
| 32      | 128           | Unpaced | 0.315567 | 0.275700 | 12.63%     |
| 32      | 2,048         | Unpaced | 0.371252 | 0.316622 | 14.71%     |
| 32      | 8,192         | Unpaced | 0.460635 | 0.421751 | 8.44%      |
| 32      | 2,048         | 30 Hz   | 2.339927 | 2.188780 | 6.46%      |

The arithmetic mean of the 16 case reductions is **9.05%**. Every count receives
equal weight, with the same four cases per count. Unpaced cases average
**9.80%**, and the four 30 Hz cases average **6.79%**. This weights each case
equally rather than allowing the 32-client workload to dominate summed CPU.
The 16-client paced case increased CPU by 2.41%; that is included in the average.

Allocations fall from **10 to 3 per client per exchange**, or **70%**, at every
count in the unpaced measurements: 40→12, 80→24, 160→48 and 320→96. Paced runs
have small additional runtime allocations. At 32 clients and 2,048 bytes,
allocated bytes per exchange fall from approximately 70,660 to 67,589: the
payload copy needed by the asynchronous outgoing queue still dominates bytes.

The isolated [receive microbenchmark](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/receive-benchmarks.txt)
ran three repetitions per implementation in alternating order, with 500 ms per
size. It parses masked in-memory frames and excludes socket I/O:

| Payload      | Before ns/message | After ns/message | Before bytes / allocations | After bytes / allocations |
| ------------ | ----------------- | ---------------- | -------------------------- | ------------------------- |
| 32 bytes     | 64.96             | 40.60            | 72 / 4                     | 32 / 1                    |
| 1,024 bytes  | 649.2             | 547.1            | 2,056 / 5                  | 1,024 / 1                 |
| 32,768 bytes | 21,766            | 18,568           | 65,544 / 5                 | 32,768 / 1                |

A separate syscall trace with 32 clients, 300 exchanges and no warmup sent
9,600 frames. Before: 19,241 `write` calls total, including approximately 19,200
header/payload writes. After: exactly 9,600 `writev` calls plus 71 setup/runtime
`write` calls. Outgoing frame writes were halved in this run; a blocked or
partially written TCP connection can still need retries. Tracing adds overhead,
so its CPU measurements are excluded. Raw [before](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/syscalls-before.txt)
and [after](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/syscalls-after.txt)
counts are retained. WebSocket frame counts and payload bytes do not change.

Median p95 exchange latency at 30 Hz was 0.898→0.829 ms, 1.157→0.955 ms,
1.492→1.563 ms and 2.432→2.585 ms at 4/8/16/32 clients respectively. The two
larger cases increased slightly. These synthetic loopback measurements do not
establish game or Internet tail latency.

The matching [CPU profiles](../../../benchmarking/experiments/2026-10-02/websocket-transport/profiles/)
show substantial remaining kernel and scheduling costs. Baseline flat syscall
samples were 57.08%; `writeFrame` accounted for 27.92% cumulatively. After the
change, `writeFrame` was 22.51% cumulatively and `runtime.schedule` was 33.33%.
Call-tree percentages overlap and must not be added. These are separate
instrumented 6,000-exchange diagnostics, not the unprofiled comparison timings.
The transport change alone cannot establish a 3× reduction in complete server
CPU. The unchanged kernel/proxy costs and scheduler work remain relevant.

## Other candidates and uncertainty

A simple local `net.Buffers` literal reduced write syscalls but added descriptor
allocations. Combining header and payload in a new contiguous queue allocation
saved a syscall too, but pushed 2,048-byte payloads into a larger allocation size
class. The retained reusable vectors achieved similar CPU savings with fewer
allocated bytes and no additional queue metadata. The
[candidate screen](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/candidate-screen.json.gz)
and [descriptor reuse screen](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/reuse-screen.json.gz)
preserve these comparisons.

An additional prototype copied small packets into a fixed 4 KiB socket buffer
and used vectors for larger packets. Its
[five-repeat comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/rejected-hybrid.json.gz)
did not consistently eliminate the four-client regression seen in an earlier
run. It added per-connection memory and a second write strategy, so it was
removed. That checkpoint uses vectors for every frame size and player count;
the [multicore follow-up](go-network-multicore-2026-10-02.md) replaces them with
one contiguous frame buffer for all sizes.

The [first 4/32-client capture](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/first-two-counts.json.gz)
measured 16–21% CPU regressions for four clients with unpaced small/medium
payloads, whereas the subsequent full comparison improved those cases. Both
captures are retained. CPU percentages, particularly small workloads and paced
runs, vary with host scheduling and frequency; allocation and syscall savings
are more deterministic. Do not infer a guaranteed CPU percentage at every
player count from the final average.

A separate [runtime experiment](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/runtime-parallelism.json.gz)
used the same optimized executable on both sides and changed only
`GOMAXPROCS=2` to `1`. Three repetitions at 4/32 clients and 2,048 bytes measured
27–29% less CPU unpaced and 20% less at 30 Hz. The previous local game harness
also forced `GOMAXPROCS=1`, while production leaves it automatic on a two-vCPU
machine. The single-CPU experiment was subsequently rejected; the server keeps
automatic CPU scheduling, and this is preserved historical evidence. Its
percentage is not attributed to the transport implementation. See the
[multicore follow-up](go-network-multicore-2026-10-02.md) for further investigation.

## Reproduction

Build the original transport with the current benchmark in an isolated copy,
then build the retained version. The original source is commit `bc0237f`.

```sh
transport_baseline=$(mktemp -d /tmp/unicorn-transport-baseline.XXXXXX)
mkdir -p "$transport_baseline/benchmarking/tools/websocket-transport" "$transport_baseline/cmd/go-server"
cp go.mod "$transport_baseline/"
cp -a internal "$transport_baseline/"
cp cmd/go-server/default.pgo "$transport_baseline/cmd/go-server/"
cp benchmarking/tools/websocket-transport/main.go "$transport_baseline/benchmarking/tools/websocket-transport/"
git show bc0237f:internal/server/websocket.go > "$transport_baseline/internal/server/websocket.go"
CGO_ENABLED=0 GOEXPERIMENT=simd go -C "$transport_baseline" build \
  -pgo=cmd/go-server/default.pgo -o /tmp/transport-before ./benchmarking/tools/websocket-transport
CGO_ENABLED=0 GOEXPERIMENT=simd go build -pgo=cmd/go-server/default.pgo \
  -o /tmp/transport-after ./benchmarking/tools/websocket-transport
BENCH_CPU_AFFINITY=0,1 taskset -c 2-15 node benchmarking/tools/websocket-transport-compare.ts \
  /tmp/transport-before /tmp/transport-after /tmp/transport-results.json.gz
```

Choose available like cores on another host. See the
[tool reference](../../../benchmarking/tools/README.md#local-websocket-transport)
for flags and the separate profile/runtime experiments. The source patch,
profiles and raw evidence are retained under
[websocket-transport](../../../benchmarking/experiments/2026-10-02/websocket-transport/).

## Validation and resources

`npm run build` passed before and after. `npm run test:go` passed all Go
packages, cross-language snapshot decoding, and complete Go/Node session parity
for 748 decoded packets, timed inputs, reconnect, catch-up and backpressure.
The new transport tests cover length boundaries, retained receive payloads,
fragmentation with interleaved ping/pong, malformed frames, one-byte partial
reads, outgoing payload ownership, short writes, queue accounting and slow-client
limits. The full comparison validates every frame through separate real TCP
clients. Go formatting checks and `npm run lint` passed; lint retains two
existing `new Array` warnings. A C compiler is unavailable in this environment,
so the Go race detector was not run.

The production Go binary, built with `CGO_ENABLED=0`, `GOEXPERIMENT=simd`,
`-trimpath` and `-ldflags='-s -w'`, grew **8,192 bytes**: 7,962,784→7,970,976.
Level-1 gzip grew 3,611,381→3,615,723 bytes. Client bundles and the Node server
bundle retain identical SHA-256 hashes and byte counts. Exact
[resource measurements](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/resources.json)
and [build settings](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/build-info.txt)
are retained. Deployment configuration, simulation, snapshot cadence and wire
protocol tags have not changed.
