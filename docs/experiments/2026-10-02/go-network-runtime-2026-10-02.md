# Go networking and runtime follow-up — 2 October 2026

**Superseded scheduler experiment.** The single-CPU restriction was removed
after review. Production leaves Go's CPU scheduling automatic. The 25.31%
and 27.23% results below include that rejected restriction and are historical
measurements, not savings attributable to the retained packet-handling code.
The [multicore networking follow-up](go-network-multicore-2026-10-02.md) measures
packet handling independently with normal CPU scheduling.

This follows the [WebSocket framing investigation](websocket-transport-2026-10-02.md).
The new comparison includes the complete Go server and its actual TCP sockets,
input decoder, owner event queue, simulation, replication and asynchronous
writers. Inputs and snapshots remain at **30 Hz**. All player counts use the
same transport and scheduler settings.

## Scheduler and packet handling

The game session has one owner goroutine. Socket readers and writers hand work
to that owner. Running two Go scheduler threads introduces cross-core handoffs,
work stealing, wakeups and lock traffic, even though the world cannot update
in parallel. A single Go scheduler thread reduced CPU in the full-server test,
not just the earlier synthetic transport test.

The single-scheduler-thread change was rejected because it restricts the
entire process, including networking, encoding, HTTP and garbage collection.
It is no longer in the production executable or offered as a tuning experiment.
The measurements are preserved to explain why their CPU reductions cannot
stand in for a transport-only result.

The retained packet-handling candidate also:

- Reuses caller-owned receive storage in the production reader. The allocating
  `ReadMessage` API remains available; `ReadMessageInto` documents reuse lifetime.
  Decoding finishes before reuse, and decoded token/object-ID data own their
  storage. Fragmented messages and queued pong payloads retain their ownership.
- Sends decoded controls through the owner channel by value, avoiding a heap
  allocation per message. The channel remains bounded at 256 events.
- Uses an atomic counter for reserved outgoing bytes, preserving byte limits
  and rollback when a frame cannot be queued.
- Removes the writer mutex: the write pump already exclusively writes every
  data/control frame. Outgoing payloads still belong to the asynchronous queue.
- Retains one completed outgoing payload buffer per connection. A send still
  copies into queue-owned storage before returning; the writer recycles it only
  after the write finishes. The one-slot spare channel bounds idle retention
  and avoids a global pool or size-dependent code paths.
- Stores optional input lead and snapshot sequence in the player record,
  avoiding temporary heap allocations during synchronous snapshot encoding.

No player-count thresholds, packet batching delays, lower-frequency modes or
physics/simulation algorithm changes are introduced.

## Full-server benchmark

`websocket-transport/main.go -game` starts the production `GameServer` on an
ephemeral loopback port. A separate Node process uses the real TypeScript
control encoder and snapshot decoder. Every client joins normally, validates
all snapshot sequences, acknowledges every snapshot and sends independently
timed inputs at 30 Hz. Client input phases are staggered across one period.
The server's normal timer sends snapshots at 30 Hz; it does not wait for a
benchmark barrier before ticking.

Measurements begin after all clients are ready and 120 normal warmup ticks
(four seconds). Each sample measures 180 tick periods (six seconds), using
server-process user plus system CPU and allocation counters. The client reports
snapshot/input rates, p95 and maximum gaps, input-acknowledgement delays and
received bytes. Comparisons alternate before/after order and require every
client to maintain at least 28.5 Hz; actual rates are retained with each sample.
Protocol bundling and connection startup happen outside measurement.

Host: Intel Core Ultra X7 358H, Go 1.27.1 with SIMD, the existing production PGO
profile and `GOGC=800`. The Go process is pinned to CPUs 0/1 and the Node
generator to CPUs 2–15. Builds, tests, profiles and timing runs are serialized.

The [first scheduler-only comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-runtime-only.json.gz) used input messages immediately following
each snapshot, three repetitions at each of 4/8/16/32 players, and the same
executable for both runtime settings. CPU reductions from two scheduler threads
to one were **20.9% / 21.4% / 29.2% / 25.9%**, respectively. Both sides delivered
approximately 30 snapshots per second. The independently timed comparison
below then exercises additional wakeups between snapshot bursts.

## Runtime plus receive-transport checkpoint

Three repetitions per case, comparing the prior transport with two scheduler
threads against reusable receive storage, value events and simpler queue
accounting with one thread. CPU is median milliseconds per 30 Hz period;
positive savings mean lower CPU. Each of the eight cases has equal weight.

| Players | Activity | Before CPU ms | After CPU ms | Saving |
| ------- | -------- | ------------- | ------------ | ------ |
| 4       | Idle     | 1.4381        | 1.1330       | 21.22% |
| 4       | Flight   | 1.5076        | 1.1643       | 22.77% |
| 8       | Idle     | 1.9363        | 1.5542       | 19.74% |
| 8       | Flight   | 2.0273        | 1.4762       | 27.18% |
| 16      | Idle     | 2.8215        | 1.9416       | 31.19% |
| 16      | Flight   | 2.9785        | 1.9771       | 33.62% |
| 32      | Idle     | 4.2087        | 3.3272       | 20.94% |
| 32      | Flight   | 4.7658        | 3.5364       | 25.80% |

The [checkpoint's mean reduction](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-runtime-transport.json.gz) is **25.31%**. This is a complete server-process comparison
for these two local workloads, rather than a transport-only percentage. The
baseline already includes the previous vectored-write/framing improvements;
this is an additional reduction, not a new Go-versus-Node comparison.

Snapshot/input rates stayed approximately 30 Hz. The lowest measured snapshot
rate was 29.833 Hz, a one-snapshot difference at a six-second measurement
boundary. Median per-run worst-client p95 input acknowledgement delays changed
by less than 3 ms in all cases; most were approximately 63–67 ms on both sides.
The workload deliberately targets inputs one tick ahead, so this measures
acknowledgement timing, not visual control response or Internet RTT.

Receive-buffer and event reuse remove approximately **four allocations per
client per tick**: two incoming frame payloads and two decoded control objects.
The full-server allocation reduction includes simulation allocations, so its
percentage varies by activity even though the transport implementation is
identical at every count.

## Input queue and send storage

The input queue now uses `MaxPredictionTicks + 1` reusable tick slots. Each
accepted tick in the existing inclusive prediction window has a distinct slot;
the tick tag prevents stale data from being applied when storage wraps. Inputs
retain their sequence/offset rules, and disconnect, reconnect and respawn clear
queued changes. Catch-up still applies each tick's control edges in order.

The initial [session comparison with legacy two-per-second inputs](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-input-queue-2hz.json.gz)
showed a **1.15% CPU regression**, averaged over the 16 player-count/route cases.
Those very short cases did not fill all reusable slots during warmup. A
[full-server flight comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-input-queue-network.json.gz)
at independent 30 Hz inputs showed **1.05% mean CPU savings**, including an
8-player regression. These results alone were too weak to justify the queue.

The longer [session comparison with 30 Hz inputs](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-input-queue-30hz.json.gz)
uses 1,800 measured ticks, three repetitions and all 16 established
4/8/16/32-player convoy/spread/contact/module cases. Both variants use one
scheduler thread and `GOGC=800`. It averages **2.37% lower CPU**, while removing
approximately two allocations per player per tick. Packets, byte counts,
entities, contacts, events and final states agree; all recorded motion
differences are zero. Individual CPU cases range from a 5.12% regression to a
12.74% improvement. The queue is retained for this modest average gain and
stable allocation reduction, using one implementation at every player count.
It retains 61 slot headers and their warmed input storage per player with the
current catalog, rather than allocating and deleting map entries every tick.

The separate [send-buffer reuse comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-send-buffer-reuse.json.gz)
isolates the one-buffer spare channel with the same runtime setting and
transport on both sides. Three repetitions cover 128/2,048/8,192-byte unpaced
exchanges and 2,048-byte 30 Hz exchanges at each player count. Equal-case mean
CPU reduction is **8.12%**, or **2.10%** for the four paced cases. The 4-player
paced case regressed 2.88%; gains were largest for 8 KiB payloads. WebSocket
payload allocations fall from one per client/exchange to approximately zero
after warmup, at every count and payload size. Neither these percentages nor
the input-queue percentage should be added to the full-server reduction.

## Final combined comparison

The [final comparison](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-combined-game.json.gz)
includes every retained change above, with three repetitions per case and
independent 30 Hz inputs. Its baseline already has the earlier vectored-write
transport. Equal-case mean CPU reduction is **27.23%**.

| Players | Activity | Before CPU ms | After CPU ms | Saving | Before allocations/tick | After allocations/tick |
| ------- | -------- | ------------- | ------------ | ------ | ----------------------- | ---------------------- |
| 4       | Idle     | 1.5010        | 1.0733       | 28.49% | 82.9                    | 52.0                   |
| 4       | Flight   | 1.4680        | 1.0845       | 26.13% | 93.4                    | 61.5                   |
| 8       | Idle     | 1.9466        | 1.4496       | 25.53% | 149.3                   | 85.4                   |
| 8       | Flight   | 1.9729        | 1.6325       | 17.26% | 176.6                   | 113.3                  |
| 16      | Idle     | 2.8795        | 1.9633       | 31.82% | 286.1                   | 158.2                  |
| 16      | Flight   | 3.0794        | 2.0514       | 33.38% | 349.3                   | 221.3                  |
| 32      | Idle     | 4.4421        | 3.1930       | 28.12% | 557.9                   | 302.1                  |
| 32      | Flight   | 4.9793        | 3.6312       | 27.07% | 704.6                   | 442.6                  |

Every client in all 48 samples delivered at least **29.994 Hz** for both inputs
and snapshots. The largest recorded snapshot gap was **39.16 ms**. Median
worst-client p95 input-acknowledgement delay changed by at most **1.16 ms** per
case. Across all cases, the maximum recorded input-acknowledgement delay was
69.99 ms before and 71.47 ms after. These are diagnostic loopback timings, not
browser response or Internet latency.

Approximately **eight allocations per player per tick** were removed. Total
server allocation reductions range from 34% to 46% because gameplay/replication
allocations vary by workload. The final CPU result is slightly stronger than
the 25.31% checkpoint, but the two captures were collected at different times;
their difference does not isolate the queue/send-buffer contribution. The
isolated experiments above report those smaller, variable gains separately.

Median received bytes per snapshot differ by less than 0.13% in seven cases.
The 4-player flight case received 4.13% fewer bytes per snapshot after the
change: independently timed joins/inputs can shift the real-time trajectory.
The controlled session comparison instead verifies matching byte counts and
final states for the input queue. No encoding schema or simulation algorithm
was changed.

## Remaining costs in the profiles

Separate 32-player flight profiles use 600 measured tick periods (20 seconds)
and are excluded from the CPU comparison. The
[before profile](../../../benchmarking/experiments/2026-10-02/websocket-transport/profiles/research-game-before.pprof)
and [after profile](../../../benchmarking/experiments/2026-10-02/websocket-transport/profiles/research-game-after.pprof)
sampled 2.89 and 1.96 seconds of CPU respectively. Sampled futex time fell from
300 ms to 60 ms, supporting the scheduler-handoff explanation. These small
sampling totals cannot establish precise phase savings.

Linux syscall wrappers remain about 30% of sampled CPU, including socket reads,
vectored writes and polling. The
[before top table](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-game-before.top.txt)
and [after top table](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-game-after.top.txt)
retain both flat and cumulative samples; overlapping cumulative values must
not be added together. The existing one-write-per-frame transport is retained.
Removing queue ownership or write deadlines would require different lifetime
or backpressure handling, beyond the simple improvements measured here.

## Validation, limitations and reproduction

- `npm run build` passed before and after the functional changes, including
  TypeScript checking and the production client/server bundles.
- `npm run test:go` passed. The TypeScript/Go session oracle matched 748 decoded
  packets, timed inputs, reconnect, catch-up and backpressure.
- Focused tests cover receive reuse with fragmentation/ping, concurrent queue
  accounting, concurrent outgoing payload ownership, prediction-window wrap,
  duplicate inputs and reconnect clearing. The existing malformed-frame,
  partial-read, short-write, slow-client and concurrent-connection tests passed.
- `npm run lint` passed with the two existing `new Array` warnings;
  `npm run format:go:check` passed.
- The [receive allocation benchmark](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-receive-benchmarks.txt)
  confirms zero bytes/allocations per unfragmented reused read at 32, 1,024 and
  32,768 bytes. The owning API still allocates one payload, as intended.
- [Production startup checks](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-startup.txt)
  recorded the subsequently rejected scheduler change and clean SIGTERM
  shutdown. They do not describe the current executable.
- Retained patches were replayed against `bc0237f` and reconstructed all four
  final production files exactly. Capture hashes and archived harness hashes
  were verified. Local servers/clients started for this work were stopped.

The race detector was unavailable because this host has no C compiler. The
ordinary Go suite includes the concurrent writer/reader ownership checks above.

The [resource capture](../../../benchmarking/experiments/2026-10-02/websocket-transport/results/research-resources.json)
uses identical stripped build flags and full-file gzip level 1:

| Resource        | Before bytes | After bytes | Before gzip bytes | After gzip bytes |
| --------------- | ------------ | ----------- | ----------------- | ---------------- |
| Go executable   | 7,970,976    | 7,958,688   | 3,615,723         | 3,613,201        |
| Node server JS  | 105,936      | 105,936     | 46,229            | 46,229           |
| Client index JS | 119,645      | 119,645     | 53,386            | 53,386           |
| Docked JS       | 4,708        | 4,708       | 2,451             | 2,451            |
| Sound JS        | 1,681        | 1,681       | 948               | 948              |

The Go executable shrank **12,288 bytes**; every JS resource's hash is unchanged.

These are local loopback CPU measurements on one processor. They cover small
idle/flight sessions, not the Fly host's CPU allocation, proxy/TLS path, Internet
latency or heavy browser gameplay. The six-second samples are short, and small
incremental results show run-to-run variation. No claim of a threefold
Go-versus-Node reduction follows from these comparisons.

The follow-up baseline is commit `bc0237f` plus the
[previous retained transport patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/retained-transport.patch).
The [historical runtime patch](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-final-runtime.patch)
includes the rejected scheduler change; it is archived evidence, not a patch
to apply to production. The earlier
[receive/event checkpoint](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-transport.patch)
and [input-queue checkpoint](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-input-queue.patch)
preserve the intermediate variants measured above. The scheduler-only capture
used the [archived snapshot-triggered harness](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-scheduler-harness.tar.gz);
its three source hashes were checked against that capture. Other historical
captures use the [pre-removal harness](../../../benchmarking/experiments/2026-10-02/websocket-transport/patches/research-pre-removal-harness.tar.gz).

Active reproduction commands are in the
[multicore follow-up](go-network-multicore-2026-10-02.md). They compare packet
handling with identical CPU allocation, and do not reproduce or reinstate
the rejected scheduler restriction in this historical capture.
