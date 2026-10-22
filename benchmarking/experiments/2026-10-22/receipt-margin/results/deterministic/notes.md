# Stateless receipt margin deterministic screen

Implementation and sources: `benchmarking/tools/receipt-margin.ts` generates retained overlays and executables under `benchmarking/local/receipt-margin`. `manifest.json` records all source paths and SHA-256 hashes. Frozen input source is `/tmp/unicorn-receipt-baseline/game-session.go`; production source was not edited by this tool.

Run: `node benchmarking/tools/receipt-margin.ts > /tmp/unicorn-receipt-margin-sweep.log 2>&1`. To retain elsewhere or read another frozen directory, set `RECEIPT_MARGIN_DIRECTORY` and `RECEIPT_MARGIN_BASELINE`. `--prepare` writes source/overlay/manifest without compiling or executing. Go builds use `GOEXPERIMENT=simd CGO_ENABLED=0`.

The sticky overlay is byte-identical to the frozen game session. Stateless overlays delete the `receiptLag` field, reconnect reset, and high-water update. Only the receipt interval changes to `max(1, snapshotWindow-currentLag-margin)` for margins 2/3/4. A load snapshot with tick below zero uses lag zero. One-second active-progress recovery, nine/two slot windows, inherited tails, probe requests, input handling, and wire acknowledgments remain unchanged.

Each of 15 scenarios measures 1,800 consecutive input edges after 240 warmup ticks, then drains 240 ticks. Four policies yield 108,000 measured edges. This is an authoritative-session flow-control model: snapshots arrive instantly, only requested return receipts are delayed, and the return path preserves WebSocket order with `max(previous arrival, next arrival)`. Every returned receipt is delivered separately even when arrivals share a tick. Jitter is request-indexed, so this tests policy robustness rather than equal wall-time network traces or CPU. The acknowledgment clock starts at server input Receive, not client dispatch; it includes the quarter-tick scheduled input and excludes renderer/Internet delays. Receipt-only stalls allow physical inputs to continue, deliberately isolating backpressure from input arrival.

All 60 executions passed cap-nine, current-input/control consumption, and final cumulative wire-acknowledgment checks. There were zero lost input edges/control mismatches. Fixed delays 1/2/6/8 maintain 30 snapshots/s for every policy. Fixed18 and jitter including10 respect the existing slow policy and eventually acknowledge every input. Sticky passes every healthy no-gap gate; no stateless margin passes.

| Scenario | Sticky | Margin 2 | Margin 3 | Margin 4 |
| --- | ---: | ---: | ---: | ---: |
| Wide jitter [2,8,3,1], snapshots/1800 | 1800 | 1500 | 1423 | 1620 |
| Wide jitter, input ACK p99 ms | 33.3 | 166.7 | 166.7 | 66.7 |
| Wide jitter, returned receipts/s | 30.00 | 6.67 | 7.88 | 12.00 |
| Learned8 then twenty1 then8, snapshots/1800 | 1800 | 1720 | 1724 | 1728 |
| Learned8/low1 spikes, input ACK p99 ms | 33.3 | 166.7 | 166.7 | 133.3 |
| Learned8/low1 spikes, longest missing ticks | 0 | 5 | 4 | 3 |
| Learned8/low1 spikes, returned receipts/s | 29.88 | 5.58 | 7.02 | 8.80 |

All four cyclic phases of wide [2,8,3,1] also fail for every stateless policy. Margin4 sends 1620, 1706, 1544, and 1542 snapshots/1800; p99 is 66.7, 66.7, 100, and 100ms. Sticky sends all1800, with p99 33.3ms in every phase. The existing shorter fixture's one favorable startup phase did not establish robust margin4 behavior.

Causal traces are retained in each scenario's `missingExamples`, including 16 ticks preceding its first three misses. In the wide-jitter trace, ordered receipts with lags8,5,2 arrive together. Stateless margin4 ends the batch at interval3 after hearing the fast tail; the next lag8 receipt then exhausts the nine outstanding snapshots. Sticky retains observed8 and keeps interval1. In the learned8/low1 trace, a margin4 low-lag receipt permits interval4, then the next requested receipt takes8 ticks. The prior cumulative receipt boundary plus4 request spacing plus8 return delay cannot fit nine snapshots, producing three blocked ticks. These are healthy <=8 measured lag receipts, so the one-second slow-recovery path does not intervene.

After an isolated18-tick receipt hold, overall ACK p99 is66.7ms for all policies, while the separate stall tail is433–500ms and the steady phase remains33.3ms. After a60-tick hold, p99 ranges1233–1300ms, steady33.3ms. Repeated18-tick holds give sticky p99333.3ms versus margins2/3/4 433.3/400/366.7ms; receipt rates fall from24.05/s to7.0/8.33/10.5/s. These return-path savings trade away healthy jitter cadence and cannot meet a no-tail-regression requirement.

Scoped TypeScript type-aware lint and formatting passed. Raw results: `benchmarking/local/receipt-margin/{sticky,margin-2,margin-3,margin-4}/deterministic.json`, summarized by `summary.json`; log `/tmp/unicorn-receipt-margin-sweep.log`. No CPU/renderer conclusion is drawn from these logical-tick runs. Root owns separate real TCP/CPU/browser comparisons and final documentation/archive.
