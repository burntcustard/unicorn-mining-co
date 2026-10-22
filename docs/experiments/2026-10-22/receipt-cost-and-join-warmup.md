# Live receipt lag, join warmup and receipt cost — October 22, 2026

Two full live suites (32 cases, 4–32 benchmark clients each) ran against
production with the connection logging added after the
[receipt margin comparison](receipt-margin.md). This note records what they
showed, the changes made in response, and the measured cost of a receipt.
Everything below comes from benchmark clients on one host; no real-player sessions
had been logged yet.

## Live findings

| Players | Connections | Held lag ≥6 | Receipts/s, all | Pinned | Unpinned |
| ------: | ----------: | ----------: | --------------: | -----: | -------: |
|       4 |          34 |      0 (0%) |             4.8 |      – |      4.8 |
|       8 |          64 |      6 (9%) |             6.7 |   16.2 |      5.7 |
|      16 |         128 |    45 (35%) |            13.3 |   22.1 |      8.5 |
|      32 |         256 |  256 (100%) |            18.5 |   18.5 |        – |

- Healthy 4-player links never pinned. At 16 and 32 players the benchmark host
  saturates (host CPU 93–99%, client FPS 2–15), and pinning varied between runs:
  16-player convoy pinned 0 of 16 connections in one run and 11 of 16 in the
  other. Worst-workload input acknowledgment p95 differed between runs by up to
  2×, so the suite cannot resolve small latency changes.
- Pinned connections first reached lag 6 within 1–3 seconds of each other, 2–3
  seconds after connecting at 32 players. That is every client loading at once.
- 93.5% of all inputs arrived with a tick already in the past; none were
  duplicates, far-future or compressed, so the backlog-compression path is only
  covered by its synthetic tests.
- The reported `max_gap_ms` (633 ms at 4 players, 2.2–2.6 s at 32) was the join
  time, because the gap was seeded when the connection began.
- Fly's CPU graph peaked near 10% of both vCPUs at 32 players, against a 6.25%
  baseline, with no throttling and a rising burst balance.

## Changes

- **Join warmup.** Receipt lag in the first 10 seconds after a connection's first
  regular snapshot still triggers recovery and sets that receipt's spacing, but is
  not added to the remembered high-water mark. It is reported as `join_lag`, and
  `high_lag_s` now counts only later stalls. A reconnect restarts the warmup.
- **Instrumentation.** `max_gap_ms` starts at the first regular snapshot. A
  `server-load` line beside each 10-minute `server-stats` reports process CPU
  (`getrusage`), tick duration, event-loop catch-up, garbage collection and
  heap, so server stalls can be told apart from client stalls and CPU can be read
  without SSH. Timing runs only when logging is enabled.

## Cost of a receipt

A receipt costs the session about **0.19 µs** (`BenchmarkReceiveSnapshotAck`,
4 allocations): 60% of that is `useSector` map lookups and the closure. This is
not worth changing.

The cost is in the read path. Forty loopback WebSocket connections sent 19,840
one-message receipts over 8.4 seconds from a separate Node process, measured as
server-process CPU minus an idle baseline: **18.3 µs per receipt** (0.363 s,
identical across two repetitions; AMD Ryzen 7 5800X3D). That covers the read
syscall, goroutine wake, framing, decode and channel hand-off. Coalesced messages
would cost less, and a shared Fly vCPU is probably slower.

At 32 players, the extra 13.5 receipts/s per pinned client is about 430 receipts/s
or 7.9 ms of CPU per second: **about 0.2 points of the two-vCPU utilization**,
against a peak near 10%. An earlier estimate here of 1–2 points was about 4× too
high.

## Remaining

- The expiring high-water variant and the fixed every-snapshot policy are both
  deferred until real-player `held_lag` by session age and `join_lag` are logged.
- Reducing receipts per client is the only lever; the session handler is already
  negligible. Piggybacking receipts on input messages would need a client and
  protocol change.
