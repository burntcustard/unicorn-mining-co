# Stateless snapshot receipt margins — October 22, 2026

Margins 2, 3, and 4 were implemented as isolated Go compiler overlays and compared
with the current sticky receipt-lag policy. **None meets the requirement to keep
input acknowledgment latency and snapshot cadence at least as good under jitter.**
The production policy remains unchanged. The permanent jitter tests now cover
the initial phases and repeated spikes that exposed the regression.

This comparison starts from the uncommitted fixes in the
[acknowledgment](input-acknowledgment.md) and
[combat input](combat-input-latency.md) investigations. It is a local comparison,
not a deployed measurement. All candidates retain those input/presentation fixes,
the nine-snapshot cap, and the existing one-second active-progress recovery.

## Policies and acceptance gate

The baseline retains the largest observed receipt lag, capped at eight ticks,
and chooses `max(1, window - receiptLag - 2)`. Each candidate deletes that field,
its reconnect reset, and its high-water update. It chooses
`max(1, window - currentLag - margin)` with margin 2, 3, or 4. Initial load receipts
use lag zero. Recovery still uses window 2 and interval 1; the threshold, deadline,
and progress checks are unchanged.

The gate is continuous 30 Hz snapshot delivery on the existing healthy ordered
jitter cases, no lost input edges, and no larger pending window. A low receipt
rate alone cannot compensate for extra snapshot gaps in a fast combat game.

The original shorter fixture rejected margins 2 and 3 but passed margin 4 in all
12 subcases. Extending the same ordered delay pattern across its initial phases,
and alternating learned eight-tick lag with runs of fast receipts, rejects
margin 4 too. The extended permanent harness has 27 subcases, preserving the
original cases and cadence assertions. The sticky baseline passes all of them.

## Authoritative input and jitter comparison

`benchmarking/tools/receipt-margin.ts` runs the real authoritative session with
an instrumented socket. Each of 15 scenarios has 240 warmup ticks, 1,800 measured
input edges, and 240 drain ticks. Four policies cover **108,000 measured edges**.
Every edge changes controls; all are consumed correctly and cumulatively
acknowledged after simulation. No policy exceeds nine pending snapshots.

Snapshots arrive immediately in this model. Only requested return receipts are
delayed, preserving their original WebSocket order, including coalesced arrivals.
Delay patterns are indexed by receipt request, so different policies encounter
them at different world ticks. This is a flow-control robustness screen, not an
identical wall-time network replay or a renderer/CPU benchmark. ACK time starts
when the server receives an input, includes its scheduled quarter-tick offset,
and ends when the acknowledgment is encoded in a snapshot. Internet transit and
physical display latency are excluded.

The table shows one initial phase of the healthy `[2,8,3,1]` return-delay pattern.
Times are milliseconds, receipts are per client per second, and the measurement
contains 1,800 server ticks.

| Policy   | ACK p95 | ACK p99 | Longest snapshot gap | Snapshots sent | Receipts/s |
| -------- | ------: | ------: | -------------------: | -------------: | ---------: |
| Sticky   |    33.3 |    33.3 |                 33.3 |          1,800 |      30.00 |
| Margin 2 |   133.3 |   166.7 |                166.7 |          1,500 |       6.67 |
| Margin 3 |   133.3 |   166.7 |                166.7 |          1,423 |       7.88 |
| Margin 4 |    66.7 |    66.7 |                 66.7 |          1,620 |      12.00 |

Across all four cyclic initial phases, margin 4 sends 1,542–1,706 snapshots and
its ACK p99 is 66.7–100 ms. Sticky sends all 1,800 with 33.3 ms p99 in every phase.
The repeated-spike scenario uses two eight-tick receipts followed by twenty
one-tick receipts, repeated throughout measurement:

| Policy   | ACK p95 | ACK p99 | Longest snapshot gap | Snapshots sent | Receipts/s |
| -------- | ------: | ------: | -------------------: | -------------: | ---------: |
| Sticky   |    33.3 |    33.3 |                 33.3 |          1,800 |      29.88 |
| Margin 2 |    33.3 |   166.7 |                200.0 |          1,720 |       5.58 |
| Margin 3 |    33.3 |   166.7 |                166.7 |          1,724 |       7.02 |
| Margin 4 |    33.3 |   133.3 |                133.3 |          1,728 |       8.80 |

Inputs keep changing the authoritative controls every tick even when snapshots
stop. The regression delays acknowledgment and receipt of authoritative combat
updates on the affected connection. Local prediction alone cannot hide that
combat cost. A separate healthy connection can continue receiving snapshots.

The retained causal trace explains why a reserve of four is insufficient.
Ordered receipts with observed lags 8, 5, and 2 arrive together. Margin 4 finishes
that batch at interval 3 after hearing the fast tail. The next slow receipt can
then fill the nine-snapshot window. In the spike case, a low-lag receipt permits
interval 4 before the next requested receipt takes eight ticks. Sticky remembers
the eight-tick observation and keeps interval 1. All these observed lags are at
or below the healthy threshold, so the one-second recovery does not intervene.

Every policy maintains 30 Hz and 33.3 ms ACK p95/p99 under fixed receipt delays
of 1, 2, 6, and 8 ticks and the ordinary `[2,4,3,2]` jitter pattern. Margin 4 costs
7.5 receipts/s at fixed lag 1 and 10/s at fixed lag 2, versus sticky's 5 and 6/s.
The proposed approximate 10/s therefore depends on measured lag; it is not a
fixed rate. These clean-link gains in simplicity trade away wider jitter safety.

## Stalls and browser responsiveness

Receipt-only holds of 18 and 60 ticks preserve input processing and eventually
acknowledge every measured edge under all policies. A single 18-tick hold gives
66.7 ms overall ACK p99 for every policy, but its separate outage tail reaches
433–500 ms. A 60-tick hold gives overall p99 1,233–1,300 ms. Repeated 18-tick holds
give p99 333.3 ms for sticky versus 433.3, 400.0, and 366.7 ms for margins 2–4.
The one-second recovery code is identical in all four variants; the interval
chosen after recovery changes subsequent behavior.

Matched visible-window Chrome captures use the normal Go/Vite proxy, the same
docked-spawn fixture, normal equipment purchases, and the unchanged client
prediction/presentation code. Each combat capture has 20 neutral steering and
20 ready-autogun trials. There is no added delay in this table; times are
milliseconds from trusted keydown to completed game draw submission.

| Measurement                                   |      Sticky |    Margin 4 |
| --------------------------------------------- | ----------: | ----------: |
| Local steering p95 / p99                      | 11.9 / 12.3 |  7.5 / 12.4 |
| Local projectile or muzzle draw p95 / p99     |  9.9 / 10.9 |  9.8 / 10.7 |
| Remote firing feedback p95 / p99              | 52.9 / 72.2 | 52.2 / 64.0 |
| Application input ACK p95 / p99, all 83 sends | 42.9 / 43.8 | 42.9 / 51.0 |
| Snapshot deliveries/client/s                  |       29.93 |       29.97 |
| Receipt sends/client/s                        |        4.27 |        5.97 |
| Longest pilot snapshot gap                    |        67.0 |        67.2 |

Both policies give actual firing feedback on the first eligible render frame in
19/20 trials; the remaining trial takes one extra frame. Both have 40 trusted
and zero untrusted keydowns, zero readiness failures, missing responses, remote
ambiguities, or browser errors. Completed-frame p95 is 10.5–10.7 ms across both
clients in these captures. All 83 input sends are acknowledged. Local feedback
remains quick, with no observed benefit from the receipt change. Each column is
one capture; the percentile differences do not establish a small speedup or
regression. Draw submission excludes hardware/display scanout.

The existing network-stall scenario queues both directions for 1.1 seconds on
the pilot, with 50 ms application scheduling delay each way. It preserves send
order and observes local/remote movement, frames, snapshots, receipts, and three
pilot input edges. Its page timers model application dispatch/receipt scheduling,
not isolated wire latency. All four policies complete with zero freezes,
missing responses, missing acknowledgments, browser errors, or connection closes.

| Policy   | Pilot ACK p95/p99 | Longest snapshot gap including outage | Longest silence inside recovery | Receipt sends/client/s, pilot |
| -------- | ----------------: | ------------------------------------: | ------------------------------: | ----------------------------: |
| Sticky   |             968.2 |                               1,109.9 |                           100.4 |                         12.37 |
| Margin 2 |           1,035.0 |                               1,135.2 |                           131.9 |                          7.56 |
| Margin 3 |           1,036.2 |                               1,135.8 |                           130.9 |                          9.04 |
| Margin 4 |           1,036.6 |                               1,134.4 |                           131.4 |                         12.68 |

With just three input edges, stall p95/p99 equal the observed maximum and are
descriptive, not reliable population tails. They include an input during the
intentional outage. Recovery silence is clipped to the post-resume reporting
window; a raw gap ending there can also include the outage. The observer remains
healthy at 29.4–29.7 snapshots/s. These captures verify visible continuity and
eventual acknowledgment; they do not override the longer deterministic jitter
counterexamples.

## Server CPU

Real TCP captures run the production `GameServer` with 32 flying clients, native
WebSockets, requested receipts only, 120 warmup ticks and 300 measured ticks at
30 Hz. Three repetitions per policy rotate execution order. All binaries use the
same Go 1.27.1 SIMD compiler, PGO, two fixed physical cores, `GOMAXPROCS=2`, and
`GOGC=200`. Captures run serially without builds, tests, or browsers competing.

| Policy   | Median CPU ms/tick | Range across repetitions | Median change | Receipts/client/s |
| -------- | -----------------: | -----------------------: | ------------: | ----------------: |
| Sticky   |             1.2993 |            1.2540–1.3869 |             — |              4.43 |
| Margin 2 |             1.3329 |            1.3318–1.4139 |         +2.6% |              4.30 |
| Margin 3 |             1.3884 |            1.3546–1.4102 |         +6.9% |              5.00 |
| Margin 4 |             1.3656 |            1.3549–1.3736 |         +5.1% |              6.00 |

Ranges overlap and these are short repetitions. They establish neither a
statistically reliable CPU increase nor CPU nonregression. In particular, they
do not support the requested guarantee that server CPU is no higher.
No extra CPU matrix is justified for candidates already rejected on latency.

Every client receives 300–301 contiguous snapshots in each TCP run, with longest
gaps below 35.3 ms. Median worst-client ACK p95/p99 are 59.7/60.1 ms for sticky,
67.0/67.4 for margin 2, 67.0/67.2 for margin 3, and 65.4/65.6 for margin 4.
This historical fixture targets the latest snapshot tick **plus one**, so phase
relative to the tick adds delay; these values are not the game's minimum input
latency or proof of a receipt-induced delay when snapshot cadence is identical.
The TCP fixture stops at the measurement boundary without a drain, leaving
1–2 recent pending inputs per client; those are retained explicitly. CPU is divided
by the nominal 300 ticks, with up to one boundary snapshot of timing variation.
The separate drained deterministic screen verifies all measured input
acknowledgments.

## Validation and retained changes

The before and final production builds pass. All 70 Node test files and all Go
packages pass, along with repository lint, Go formatting, and race-enabled
transport/snapshot checks. The new helper tests cover cumulative acknowledgments,
missing/tail observations, measurement boundaries, receipt counts, and clipped
snapshot silence. The expanded jitter harness keeps its strict cadence gate;
the rejected margin-4 failure log is retained beside the passing baseline.

This comparison changes benchmark instrumentation and regression coverage.
Production `game-session.go`, the stripped Go binary, and every emitted client
asset are byte-identical to the frozen before-build baseline. There are still
nine JavaScript chunks totaling 279,557 raw bytes and 116,875 bytes summed after
individual level-1 gzip. The Go binary remains 13,516,960 raw and 6,248,897
level-1 gzip bytes. The owned Go/Vite services and browsers were stopped after
captures; standard ports 3000, 3001, and 9333 are clear.

## Reproduction and evidence

The reusable runner defaults to the current `src/server/network/game-session.go`;
`RECEIPT_MARGIN_BASELINE` selects a directory containing a frozen sticky source.
It generates isolated policies and Go test overlays without editing production
source. `--prepare` writes variants without compiling or measuring.

```sh
node benchmarking/tools/receipt-margin.ts
GOEXPERIMENT=simd go test ./src/server/network -run '^TestSnapshot' -count=1
```

Results default to ignored `benchmarking/local/receipt-margin`.
`RECEIPT_MARGIN_DIRECTORY` selects another destination. Read `healthyCadencePass`
in the results: the runner deliberately completes rejected candidates to retain
their failure traces, so process success means the sweep completed, not that
every candidate met the cadence gate.

The [retained evidence](../../../benchmarking/experiments/2026-10-22/receipt-margin/README.md)
contains all 60 scenario results, causal histories, exact policy sources,
compiler overlays, real-TCP raw measurements, browser captures, commands,
validation logs, and checksums. Earlier experiment evidence is unchanged.
