# Low-latency movement and stall recovery — 2 October 2026

This follows the [input-response simplification](ship-input-response-2026-10-02.md).
The target is a 10–50 ms round trip, with 100 ms round trips as a stress case.
A one-second interruption must not exhaust local prediction or throw away
elapsed movement when rendering resumes.

## Changes

- Removed client clock retuning, skipped/doubled ticks, and the separate
  estimated-server clock. Local simulation advances at elapsed-time speed.
- Unified prediction, replay history and frame catch-up around the existing
  `maxPredictionTicks` setting, now 60 ticks (two seconds). This is a safety
  bound, not a playback buffer. Normal frames and packets do not wait for it.
- Capture the reconciliation pose after elapsed simulation steps. Previously,
  a delayed browser frame could preserve a stale pose and ease away movement
  that legitimately happened during the pause.
- Keep the existing fast exponential release for small correction errors.
  Large errors release at no more than 60 world units/s and 3 radians/s before
  easing into the corrected pose. The release is analytic and does not restart
  when an unchanged authoritative state arrives again. Controls still feed the
  predicted pose immediately; there is no snapshot history or playback clock.
- Go and Node now retain future input edges throughout the same prediction
  horizon. The previous six-tick limit collapsed steering changes received
  while the server was behind. Stale inputs and inputs beyond the safety
  horizon still take effect at the next opportunity.

`frame-prediction.ts` needs no additional mechanism. The three client motion /
network files shrink from 827 to 781 lines in this follow-up. Prediction history
was already capped at 60 entries; recovery now uses that retained history.

## Two actual Chrome clients against Go

Each client runs the real app in its own browser context through the standard
Vite WebSocket proxy. Artificial latency delays both sends and receives. The
capture samples the actual presentation poses used by the renderer, and both
clients must retain the piloted ship throughout the sequence.

The steering harness now turns in place. Its former long flight could leave
interest range when a fresh server placed the first two players at different
spawn positions. The before/after captures below both use the corrected route.
The baseline is the already simplified implementation from the earlier report.

| Simulated RTT | Pilot first response, after | Observer first response, after | Observer minus pilot, before → after | Fitted rotation lag, before → after |
| ------------- | --------------------------: | -----------------------------: | -----------------------------------: | ----------------------------------: |
| 10 ms         |                     38.5 ms |                        41.1 ms |                        14.0 → 2.6 ms |                            5 → 2 ms |
| 50 ms         |                     43.7 ms |                       137.0 ms |                      119.2 → 93.3 ms |                           −8 → 3 ms |
| 100 ms stress |                     56.4 ms |                       139.4 ms |                      118.6 → 83.0 ms |                        −30 → −20 ms |

These are individual captures, not latency guarantees. First response includes
physical turn acceleration, server tick phase and browser scheduling. A fitted
lag compares the whole rotation trace and must not be mistaken for first-input
latency. Negative values mean the observer leads the pilot's displayed trace.
At 10 ms RTT, reversal differences were −0.9 to 0.1 ms; at 50 ms RTT, −0.3 to
3.5 ms. The 100 ms stress run still showed substantial disagreement during
reversals (the observer led by 64–84 ms), so it is not evidence of imperceptible
response on that connection. P95 frame intervals were 17.9–21.2 ms across the
three final captures, with occasional roughly 50 ms browser scheduling gaps.

The initial 50 ms RTT baseline failed the harness's first-response budget;
its capture was saved before the assertion. All three final captures passed.

## Interruptions

The deterministic test uses two actual `NetworkClient` instances, binary packets
and the Node session with a 1 ms delivery clock. It covers 60 and 144 Hz,
5/25/50 ms each way, coasting and steering, and five delivery profiles: normal,
downstream pause, both-direction pause, server pause and browser-frame pause.
Each interruption lasts 1.1 seconds. The tests assert ongoing movement,
responsive steering during delivery/server pauses, bounded corrections and
history, and convergence after recovery.

For coasting, the baseline had up to 23 frozen frames and one backwards frame,
with a recovery displacement error up to 132.6 units. The final implementation
has zero frozen/backwards frames and only floating-point error in speed.
Before limiting correction speed and retaining server input edges, steering
through a pause could reverse by 73.2 units in one frame and rotate by 0.96
radians. The final test has no backwards frames; the largest rotation step is
0.056 radians.

Separate two-browser Go runs held both directions of one client's socket,
blocked one browser's JavaScript thread, and sent SIGSTOP/SIGCONT to the owned
Go process. Each pause lasted at least 1.1 seconds, with 5 ms delay each way.

| Pause           |       Pilot frozen frames | Pilot maximum displayed speed | Observer frozen frames | Maximum ordinary frame interval across both views |
| --------------- | ------------------------: | ----------------------------: | ---------------------: | ------------------------------------------------: |
| Socket delivery |                         0 |                 289.5 units/s |                      0 |                                           22.0 ms |
| Browser thread  | 0 after rendering resumed |                 298.4 units/s |                      0 |                               21.6 ms on observer |
| Go process      |                         0 |                 272.0 units/s |                      0 |                                           23.2 ms |

The blocked browser necessarily rendered no frames during its 1,129 ms gap.
Its first resumed frame caught up 209.2 units instead of freezing at the old
position or animating through discarded elapsed time. This is not a claim that
a blocked main thread can keep drawing. Similarly, an observer cannot know
controls whose packets have not arrived: the socket-pause pilot's short turn
was entirely hidden from the server. Large resulting disagreements still
require gradual correction. These tests pause a live connection; WebSocket
closure continues to use the existing reconnect lifecycle.

## Validation and reproduction

All JavaScript test groups pass. After replacing the old replay-limit and
formula-specific contact assertions, the live prediction test and remaining
test groups were rerun successfully. Production builds and lint pass; lint
retains the two existing `no-new-array` warnings. Changed files and Go sources
pass formatting checks. The owned Chrome, Go and Vite processes were stopped,
and ports 3000, 3001 and 9333 were confirmed free.

The Go suite passes, including timed input edges beyond six ticks, binary
snapshot decoding and 748-packet Node/Go session parity. Motion regressions
measure reconciliation separately from legitimate elapsed simulation. The
slower-cadence test now supplies the world when sampling remote poses and
asserts that the peer exists; its old empty sample made that check vacuous.

Production entry: 119,940 → 119,645 raw bytes and 52,672 → 52,537 gzip-level-1
bytes (Node's zlib). Docked UI remains 4,708 raw bytes, with gzip 2,431 → 2,432
from its changed importer hash. Sound remains 1,681 / 942. Node server changes
from 105,907 / 45,455 to 105,936 / 45,451. The entry remains above the existing
14 KB chunk target.

With the Go server on 3001 and Vite on 3000:

```sh
node benchmarking/tools/input-response-browser.ts /tmp/response.json.gz 5
node benchmarking/tools/input-response-browser.ts /tmp/response-50ms.json.gz 25
node benchmarking/tools/stall-browser.ts /tmp/network-stall.json.gz 5 network
node benchmarking/tools/stall-browser.ts /tmp/browser-stall.json.gz 5 client
node benchmarking/tools/stall-browser.ts /tmp/server-stall.json.gz 5 server SERVER_PID
```

Only pass the PID of the local test server to the last command. Its `finally`
block resumes that process if the run fails. The scripts close their browsers;
the local server/frontend pair should also be stopped after testing.

[Saved captures, deterministic results, and before/after source](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-low-latency-recovery.json.gz).
