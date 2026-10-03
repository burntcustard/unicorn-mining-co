# Go networking with normal CPU scheduling — 2 October 2026

The server no longer sets `GOMAXPROCS`. The rejected single-CPU default and
per-variant scheduler switches were removed. Packet handling uses the same
implementation at 4/8/16/32 players, with **30 Hz inputs and snapshots**.

The [earlier 27.23% result](go-network-runtime-2026-10-02.md) included the rejected
CPU restriction. It is preserved as historical evidence and is not a result
for the currently retained code. This follow-up measures both variants with
normal Go scheduling on the same two CPUs.

## Process the ordered inbox when its work is needed

Socket readers still receive, validate and decode every message immediately.
Previously, sending each decoded input or snapshot receipt into the owner's
channel woke the world owner independently. That repeatedly alternated readers,
writers and the owner between the two available CPUs.

The owner now drains its existing ordered, bounded event queue immediately
before each normal simulation tick. Inputs are applied by the same
`GameSession` input rules; receipts free snapshot capacity before that tick's
send. A separate one-slot notification wakes the owner immediately for
connection changes, joins, respawns and dock controls. All messages remain in
one queue, so urgent controls preserve their order relative to preceding and
following inputs. Inputs are not coalesced or dropped.

Each drain processes at most the existing 256-event queue capacity before
returning to the owner's timer/control loop. The socket message limit remains
120 messages per second per connection. This bounds work under a busy reader.
It uses no player-count threshold, new batching timer, lower-frequency mode or
additional worker pool. Other goroutines can execute alongside the owner.

The [isolated flight comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-inbox-screen.json.gz)
changes only this inbox behavior. Both sides have the same contiguous-frame
transport and normal two-CPU scheduling. Three repetitions measure 180 periods
after 120 warmup periods:

| Players | CPU saving | Before worst-client p95 ack ms | After worst-client p95 ack ms |
| ------- | ---------- | ------------------------------ | ----------------------------- |
| 4       | 17.77%     | 66.27                          | 65.64                         |
| 8       | 19.46%     | 67.03                          | 65.05                         |
| 16      | 30.41%     | 66.65                          | 67.04                         |
| 32      | 30.25%     | 66.98                          | 67.17                         |

Mean CPU reduction is **24.47%**, giving each player count equal weight. The
lowest measured input/snapshot rate is 29.995 Hz. Rates near 30 Hz include a
one-frame measurement-boundary variation. These acknowledgements target inputs
one tick ahead and measure server acknowledgement timing, not visual response.

## Keep an entire outgoing frame in the owned send buffer

Outgoing buffers now reserve ten bytes for the largest WebSocket header before
the copied payload. The writer fills the required end of that prefix and sends
the complete frame with one ordinary socket write. This replaces `net.Buffers`
and its vector setup with a contiguous frame; there is still only one payload
copy. Every frame size uses this same layout and write strategy. The actual
header length still follows the WebSocket protocol's required 2/4/10-byte forms.

The existing asynchronous queue retains ownership until the write completes,
then retains at most one spare buffer per connection. Callers can immediately
reuse their packets. Byte accounting still counts payload bytes, so the same
queue, socket and snapshot backpressure limits apply. The ten-second write
deadline and short-write checks remain.

The [transport comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-contiguous-screen.json.gz)
uses three repetitions of 6,000 unpaced exchanges at 128/2,048/8,192 bytes and
150 paced 2,048-byte exchanges at 30 Hz, at each count. Its equal-case CPU saving
is **1.28%**, or **1.91%** across the four paced cases. The 16-player paced case
regressed 1.91%, while the others improved. These small gains are variable; the
change is retained as a single write strategy with fewer per-socket fields and
no vector descriptors. It does not account for the larger inbox saving.

Receive buffers, value controls, atomic byte accounting and reusable prediction
slots from the prior investigation remain. They avoid repeated allocations
without changing simulation algorithms, input offsets or the wire schema.

## Complete comparison of retained packet handling

The [48-sample full-server comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-full-server.json.gz)
includes all retained receive/event/input/send-buffer changes, contiguous
frames and the ordered inbox. Both sides use automatic scheduling and report
two execution CPUs. Equal-case mean CPU reduction is **25.13%**:

| Players | Activity | Before CPU ms/tick | After CPU ms/tick | Saving | Before allocations/tick | After allocations/tick |
| ------- | -------- | ------------------ | ----------------- | ------ | ----------------------- | ---------------------- |
| 4       | Idle     | 1.3363             | 1.0613            | 20.58% | 82.8                    | 50.8                   |
| 4       | Flight   | 1.3625             | 1.1523            | 15.43% | 93.1                    | 61.5                   |
| 8       | Idle     | 1.8145             | 1.4069            | 22.46% | 149.3                   | 85.4                   |
| 8       | Flight   | 1.8875             | 1.4679            | 22.23% | 176.7                   | 112.8                  |
| 16      | Idle     | 2.7564             | 1.8408            | 33.22% | 286.1                   | 158.3                  |
| 16      | Flight   | 2.8849             | 2.0479            | 29.01% | 349.2                   | 221.4                  |
| 32      | Idle     | 4.3053             | 3.0086            | 30.12% | 557.9                   | 302.2                  |
| 32      | Flight   | 4.6617             | 3.3565            | 28.00% | 701.1                   | 448.9                  |

The lowest measured snapshot rate was 29.995 Hz. The lowest input rate was
29.832 Hz, one input at a six-second measurement boundary; every sample is
approximately 30 Hz. The maximum recorded snapshot gap was **38.02 ms**. Median
worst-client p95 input acknowledgement delays were unchanged or lower within
about 0.1 ms, apart from a 4.63 ms improvement in 4-player idle. The input target
remains one tick ahead; acknowledgement time is not visual response time.

Allocations fell by about eight per player per tick. These totals include
gameplay/replication allocations and vary by activity. Median received bytes
per snapshot differ by less than 0.005% in six cases, with **4.22% more** in
4-player flight and **1.29% fewer** in 32-player flight. Real-time joins and
inputs can shift the flight trajectory; the controlled session oracle and
TCP input-edge tests check protocol and input behavior separately. The CPU
percentage is a local workload result, not a claim of a threefold Node-to-Go
improvement or a guaranteed Fly.io saving.

Separate 20-second, 32-player flight profiles support the scheduling explanation.
The [baseline profile summary](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-game-before.top.txt)
has 2.73 seconds of CPU samples, including 360 ms in `runtime.futex`. The
[retained-code summary](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-game-after.top.txt)
has 1.94 seconds, including 40 ms in `runtime.futex`. Both report two execution
CPUs. This is consistent with avoiding repeated owner wakeups while preserving
parallel execution. Profiling is separate from the timing table and its sample
counts are diagnostic, not an exact attribution of the measured saving.

The Linux syscall wrapper still accounts for about 32% of the retained profile's
samples. Its stacks include socket reads, writes and network polling, so reducing
the remaining networking work is a further candidate. These samples do not
establish that another specific transport change would improve performance.

## Verification and resources

- `npm run build` passed before and after the functional changes.
- `npm run test:go` passed, including the 748 decoded Go/TypeScript packet
  comparisons, timed input edges, reconnect, catch-up and backpressure cases.
- New real-TCP tests verify that joins are processed between ticks and that
  multiple queued input edges preserve their order, offsets and duplicate
  rejection. Both passed three consecutive runs.
- WebSocket ownership, concurrent queueing, receive-buffer reuse, fragmented
  frames, control frames, malformed frames and short writes remain covered.
- `npm run lint`, targeted benchmark formatting checks and
  `npm run format:go:check` passed. Lint reports the two existing `new Array`
  warnings. The race detector was unavailable because this host has no C
  compiler; the ordinary concurrent transport tests passed.

The [production startup check](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-startup.txt)
runs the stripped server without a scheduler override on the unrestricted
host. Go automatically reports **16 execution CPUs**, starts listening and
exits cleanly after SIGTERM. Application code contains no scheduler setter.

The [resource capture](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-resources.json)
records hashes, raw bytes and gzip level-1 bytes. With Go 1.27.1, SIMD, the same
PGO profile, `-trimpath` and `-ldflags='-s -w'`, the baseline executable is
7,970,976 bytes and the retained executable is 7,950,496 bytes: **20,480 fewer
bytes**. Gzip level-1 size changes from 3,615,523 to 3,609,178 bytes: **6,345
fewer bytes**. Both builds' metadata is retained in the
[build information](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-build-info.txt).
The generated JavaScript assets have unchanged hashes and sizes.

The [delayed-receipt validation](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/multicore-delayed-receipts.json.gz)
delays every snapshot acknowledgement by **250 ms**. It runs both variants in
idle and flight at all four player counts, for 16 samples. Every sample retains
approximately 30 Hz inputs and snapshots, with the lowest rate above 29.994 Hz.
Input acknowledgements are checked to advance, remain monotonic and reference
only inputs already sent. This exercises the bounded snapshot window with
delayed receipts; it does not model a complete bidirectional Internet link.

## Method and reproduction

The baseline is commit `bc0237f` plus the
[original retained framing patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/retained-transport.patch),
before receive/event/input/send-buffer reuse. Both variants run the production
`GameServer` on loopback TCP and keep Go's automatic CPU scheduling. They are
pinned to CPUs 0/1, where Go reports two available execution CPUs. The Node
client runs on CPUs 2–15 and uses the real TypeScript control encoder/snapshot
decoder. It sends independently timed, staggered inputs at 30 Hz and validates
every snapshot sequence and measures input acknowledgement delay.

Host: Intel Core Ultra X7 358H, Go 1.27.1 with SIMD and the same production PGO
profile, `GOGC=800`, Node 26.5.0. Each sample has four seconds of warmup and six
seconds of measurement, with before/after order alternating. CPU is process
user plus system time per measured period; medians are compared within each
case, then each count/activity gets equal weight. Timing comparisons are
serialized with builds, tests and profiling.

The capture's exact [timing harness](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/multicore-timing-harness.tar.gz)
is retained with its recorded source hashes. The current client additionally
supports delayed receipt checks and verifies input acknowledgements are
monotonic, refer only to sent inputs, and continue advancing.

The [retained packet-handling patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/multicore-packet-handling.patch)
applies after the original framing patch. The
[contiguous-frame patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/multicore-contiguous-frame.patch)
and [inbox patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/multicore-inbox.patch)
also preserve the isolated steps measured above.

The benchmark drivers no longer force one Go execution CPU or silently choose
only the first CPU from the affinity mask. Session comparisons default to the
full available affinity mask and record the actual scheduler width. Historical
captures and [their archived session harness](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-pre-removal-session-harness.tar.gz)
retain their original settings and hashes.

Build isolated baseline and candidate copies with
`CGO_ENABLED=0 GOEXPERIMENT=simd go build -pgo=cmd/go-server/default.pgo
-o /tmp/transport-variant ./benchmarking/tools/websocket-transport`, then run
from this checkout with installed dependencies and built `dist` assets:

```sh
GAME=1 REPETITIONS=3 PACED_TICKS=180 BENCH_CPU_AFFINITY=0,1 \
  taskset -c 2-15 node benchmarking/tools/websocket-transport-compare.ts \
  /tmp/transport-before /tmp/transport-after /tmp/game-multicore.json.gz
```

Use CPUs available on the host. The [tool reference](../../../benchmarking/tools/README.md#complete-game-server-at-30-hz)
documents other cases and diagnostic profiles. These short loopback workloads
do not establish Fly.io savings, Internet latency or behavior under a saturated
world. The actual production scheduler remains automatic and unrestricted by
application code; two CPUs are the common local test allocation, not a new
production setting.
