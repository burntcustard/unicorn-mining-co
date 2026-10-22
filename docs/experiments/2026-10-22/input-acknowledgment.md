# Input acknowledgment regression — October 22, 2026

The live regression has a concrete flow-control explanation: cumulative receipt
batching increased the number of snapshots an overloaded client could have in
flight from 9 to 15. The client then decoded more old state before reaching the
snapshot acknowledging its latest input. Repeated local captures show that
restoring the original window alone is insufficient to beat the older server.
The retained change uses a two-snapshot window during recovery until the client has
made regular receipt progress for one second, and remembers the connection's
longest observed receipt lag when choosing how often to request a receipt.

Across the repeated local captures, median run input acknowledgment p95 falls
from **637.2 to 440.7 ms**, **30.8% below the deployed policy** and **16.3% below
the older server's 526.8 ms**. The final build, full test suite, race checks,
formatting, lint, and keyboard-response check pass. This report separates those local measurements from the original live
comparison in [live results](../../../benchmarking/live/results.md).

## Original live evidence

The pre-deployment suite exercised revision `5cfd246` and the post-deployment
suite exercised `e581671`. Both completed the full 4/8/16/32-player
convoy/spread/contact/module matrix. Browser, host, runner, viewport, and deployed
client asset hashes matched. Each used 15 seconds of warmup and 60 seconds of
measurement. The persistent world continued evolving between captures.

| Players / workload | Input ack p95 ms, before → deployed | Snapshots received before input ack p95 | Fast batches larger than 9 snapshots |
| ------------------ | ----------------------------------: | --------------------------------------: | -----------------------------------: |
| 16 convoy          |                         88.0 → 79.9 |                                   2 → 2 |                                0 → 0 |
| 16 spread          |                         45.9 → 44.1 |                                   1 → 1 |                                0 → 0 |
| 16 contact         |                         63.3 → 70.2 |                                   1 → 2 |                                0 → 0 |
| 16 module          |                       265.7 → 294.9 |                                   7 → 7 |                               1 → 53 |
| 32 convoy          |                       338.5 → 495.3 |                                  9 → 14 |                            0 → 1,185 |
| 32 spread          |                         52.3 → 55.0 |                                   1 → 1 |                               0 → 11 |
| 32 contact         |                       435.3 → 521.8 |                                  9 → 12 |                              0 → 810 |
| 32 module          |                       640.4 → 779.3 |                                  9 → 14 |                              1 → 872 |

Each acknowledgment p95 pools the measured input samples in its case. A fast
batch groups snapshots whose consecutive JavaScript receipt timestamps are at
most 5 ms apart; its size describes observed delivery, not an independently
measured socket queue. The intervening-snapshot count excludes the snapshot
carrying the acknowledgment.

For 32-player modules, acknowledgments after more than nine intervening
snapshots increased from **0/5,807 to 1,607/5,693 (28.2%)**. The post-deployment
p95 within that group was **818.6 ms**. The largest fast batch increased from
10 to 15, and fast batches above nine increased from 1/19,481 to 872/19,762.
Convoy and contact batches previously never exceeded nine and subsequently
reached 15.

Both module cases saturated the local SwiftShader host: median client FPS was
about 2.2, and pooled frame-interval p95 was 816.7 ms in both. Controller-loop p95
rose from 1,047.5 to 1,254.8 ms against a 250 ms target. The first snapshot after
an input arrived at p95 243.8 versus 305.5 ms. Input target lead relative to the
latest delivered tick had unchanged median zero and p95 ten ticks; extra future
input scheduling alone does not explain the regression.

World variation remains relevant. Median visible entity count changed from 42
to 46 in 32-player modules, while median payload download changed from 233.0 to
229.1 KiB/s. A live before/after pair cannot precisely attribute every
millisecond to one server change. The changed backlog shape, deployed source
diff, and local reproduction together support the receipt-window mechanism.

## Why fewer receipt requests increased the backlog

Snapshot receipts and input acknowledgments serve different purposes. A client
receipt confirms that it received a snapshot and all preceding snapshots. An
input acknowledgment tells the client which player input the server accepted.
The latter remains present in ordinary snapshots even when that snapshot does
not request a receipt.

The [CPU transport investigation](go-server-cpu-transport.md) reduced control
messages by requesting cumulative receipts less frequently. On a fast link,
the interval is the healthy nine-snapshot window minus measured receipt lag and
two reserve slots. The deployed implementation also added `ackInterval - 1` to
the in-flight allowance. With interval seven, that permitted **15 snapshots**.
This protected cadence when receipts were spaced, but weakened the original
backpressure when a renderer stopped consuming state.

When the client resumes, decoding the extra old snapshots competes with rendering
and postpones the state containing a fresh input acknowledgment. More buffered
snapshots can reduce the p95 gap between delivered snapshots while making their
state older. The live improvement in snapshot-gap p95 therefore does not
establish improved input latency.

## Bounded receipts and recovery

The fix in [game-session.go](../../../src/server/network/game-session.go) uses
the original snapshot window as its in-flight allowance: nine on healthy links
and two after slow receipts. Existing pending entries retain their previous
allowance when the window shrinks. The final available slot requests a receipt,
and an unrequested tail can send a current-state probe so delivery can resume.

A connection also retains a high-water mark of observed receipt lag, capped at
eight ticks. Receipt spacing uses this mark rather than only the most recent
round trip. A single fast receipt after a stall therefore cannot immediately
restore an optimistic batching interval and cause another stall. Reconnecting
clears the lag history. The cap is sufficient because eight ticks already imply
a receipt request on every snapshot in the healthy window.

The first candidate combined this bound and lag history, but its three browser
captures did not meet the earlier server's latency. A fast receipt after a stall
could still reopen the nine-snapshot window while the client was recovering.
A second candidate added a one-second recovery deadline whenever a receipt was
more than eight simulation ticks old. That timer alone also failed to beat the
older server: time spent without receipt progress could expire the deadline and
let the next fast receipt reopen nine prematurely.

The retained change requires **one second of regular receipt progress**. A
receipt more than eight ticks old starts or extends recovery. While recovery is
active, a gap of more than eight ticks between actual receipts also renews the
deadline, even when it expired during the quiet period. The window stays at two
until the deadline passes with receipt gaps at most eight ticks and a timely
receipt arrives. It then reopens nine and clears recovery. Reconnecting clears
the lag history, recovery deadline, and last-receipt tick.

These rules trade some receipt-message CPU savings and temporary snapshot
cadence for tighter backpressure after a stall. If a link settles above a
two-tick round trip after a spike beyond eight ticks, the two-snapshot recovery
window can temporarily deliver below 30 Hz. Ordinary fast links retain the
healthy window and 30 Hz cadence; links with a recorded long stall request
receipts more frequently for that connection. Recovery uses simulation ticks,
and input acceptance continues while snapshots are flow-controlled. Production
client code, wire fields, protocol version, and cumulative receipt semantics
remain unchanged.

The added cadence coverage checks jitter, delayed receipts, the nine-snapshot
bound during a client stall, recovery of current input acknowledgments, window
shrinkage with an unrequested tail, and connection-history reset. The first
resumed snapshot explicitly acknowledges the latest input sequence. The stall
regression fails on the deployed algorithm's expanded backlog and passes with
the retained fix.

## Repeated local browser comparison

The serial comparisons use 32 normal production clients running the module
workload at 320 × 200 in Chrome 156.0.8078.47, with 15 seconds of warmup and
45 seconds of measurement per variant. All client asset SHA-256s matched.
The local servers used GOGC=200, GOMAXPROCS=2, and the same current PGO input.

| Local server variant                          | Run 1 ack p95 ms | Run 2 | Run 3 | Run 4 | Median run p95 ms |
| --------------------------------------------- | ---------------: | ----: | ----: | ----: | ----------------: |
| All Go sources from pre-deployment `5cfd246`  |            505.9 | 638.1 | 547.7 | 492.1 |             526.8 |
| Deployed receipt policy on the current server |            651.5 | 656.5 | 549.7 | 622.9 |             637.2 |
| Nine-snapshot cap and lag history only        |            413.5 | 704.4 | 595.3 |     — |             595.3 |
| Added recovery deadline only                  |            517.3 | 571.0 | 564.1 |     — |             564.1 |
| Recovery requiring regular receipt progress   |            478.2 | 440.7 | 378.6 |     — |             440.7 |

Each run p95 pools measured input acknowledgments across its clients. The final
column is the median of the available run p95s, not a pooled percentile across runs.
The cap-only candidate's initial 413.5 ms result did not persist: its median
595.3 ms remained above the older server's 526.8 ms. The timer-only candidate's
564.1 ms median also missed that target. Both are retained as insufficient
experiments. Every receipt-progress capture is below every deployed-policy
capture, and its median is below the older reference. The fourth old and
deployed captures also used 32 players.

All **17 browser captures** completed with no reported client exceptions or
socket closes. Host CPU use remained about 99.8%. The retained candidate's pooled
frame-interval p95s were **800.0, 750.0, and 833.3 ms**: the client rendering
bottleneck remained while acknowledgment delay improved.

The deployed-policy and receipt-fix variants isolate receipt logic on the
current server. The old-source variant also changes simulation/transport code
and uses the current PGO input, so it is a reference for the earlier latency
behavior, not a reconstruction of the older CPU benchmark executable. Real-time
browser control produces different trajectories between runs even with matching
setup. These measurements establish the local result; the live post-deployment
comparison remains a separate measurement.

Local diagnostic selection is restricted to HTTP loopback port 3000. The public
runner's default remains the full live matrix, and local diagnostics do not
append to the live report. With the intended production client and local server
already running, the focused capture is:

```sh
BENCH_URL=http://localhost:3000/ LOCAL_ACK_PLAYERS=32 LOCAL_ACK_WORKLOADS=module BENCH_SECONDS=45 BENCH_WARMUP=15 node benchmarking/tools/live.ts benchmarking/local/ack-browser-fixed.json.gz
```

## Normal transport, validation, and resources

Three alternating pairs per player count used the real TCP game harness at
30 Hz, with 120 warmup ticks and 300 measured ticks. These compare the deployed
receipt algorithm with the final fix, with no browser capture or build running
alongside measurement. Values are medians across runs; acknowledgment p95 is
the worst client's p95 in each run.

| Players | CPU ms/tick, deployed → fixed | Input ack p95 ms, deployed → fixed |
| ------- | ----------------------------- | ---------------------------------- |
| 4       | 0.3044 → 0.3109               | 66.34 → 66.33                      |
| 32      | 1.4089 → 1.3707               | 66.58 → 66.83                      |

Normal-link latency stays near 67 ms. CPU differs by +2.1% at four players and
−2.7% at 32; these short samples do not establish a general CPU change. They
show that the fix preserves normal cadence and does not materially increase
the measured normal-link acknowledgment latency.

The final production build, all **69 Node test files**, all Go packages,
`npm run lint`, and `npm run format:go:check` pass. Linux socket tests with
`--race` cover actual backpressure, partial writes, ordering, and concurrent
producers alongside the permanent snapshot/input regressions. A two-client
Chrome keyboard test through the normal development proxy with 5 ms delay each
way also passes, with first local/remote visual responses of 13.2/67.8 ms.
The temporary browsers and local services were stopped after testing.

The stripped server remains **13,521,056 bytes**. Node gzip level-1 size changes
from **6,249,771 to 6,249,683 bytes** (88 bytes smaller). Production client assets
are unchanged; the browser captures verify matching deployed script hashes.
The PGO profile is unchanged. Exact binary and profile hashes, capture checks,
and per-run metrics are in the retained [summary](../../../benchmarking/experiments/2026-10-22/input-acknowledgment/results/summary.json).

## Timing interpretation and retained evidence

The probe measures from `WebSocket.send()` to the JavaScript receipt of the first
snapshot acknowledging the input. It includes browser/transport queuing,
server acceptance and scheduling, snapshot gating, and receipt dispatch. It
excludes the earlier time between a control decision and sending. Multiple input
changes during one controller invocation contribute separate samples, so this
metric is sample-weighted. It is distinct from visual prediction response.

CDP frame timestamps and JavaScript receipt timestamps can be paired by server
tick after removing their clock offset. Their relative dispatch-residual p95 was
0.3 ms in both 32-player module captures. Both timestamps observe the same
overloaded delivery batches; this does **not** independently measure wire arrival
or establish that network delay was small.

A diagnostic model assumes 30 ticks/s and calibrates its tick clock with the
earliest observed CDP receipt relative to server tick. It estimates module
acknowledgment snapshot age p95 at **574.3 → 689.2 ms**, while estimated
send-to-generation p95 is **60.5 → 54.8 ms**. This supports stale delivery rather
than slower input acceptance as the dominant contribution. These are relative
estimates, not direct server timestamps: unknown fixed network latency shifts
the split, tick-rate drift limits precision, and separate p95s do not add to the
total p95.

The [retained results](../../../benchmarking/experiments/2026-10-22/input-acknowledgment/results/)
contain the evidence summaries and browser captures. The
[source snapshots](../../../benchmarking/experiments/2026-10-22/input-acknowledgment/sources/)
preserve the compared implementations. The reusable
[analysis script](../../../benchmarking/tools/live-ack-analysis.ts) joins every
acknowledgment to its input and receipt timestamp, records per-client and pooled
distributions, counts delivery batches, and includes the timing-model caveats.
The original captures are identified by SHA-256:

| Capture                            | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `2026-10-22T08-52-58.305Z.json.gz` | `1ecc1d102bcb930b061c43d91ee6ee559079070c6641d31ce9e25e8cdc12981a` |
| `2026-10-22T11-50-52.199Z.json.gz` | `35473332ec7396937d6093b0d3f268443037e5c9a1eb98939e6276e78876c7c3` |
