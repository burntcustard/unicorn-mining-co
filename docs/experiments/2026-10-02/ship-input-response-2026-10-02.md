# Ship input response — 2026-10-02

The same ship was measured on its pilot's canvas and an observer's canvas in
separate Chrome browser contexts. The original working-tree client added about
97 ms of rotation lag on a nearby flight route. The simplified client measured
5 ms with Node and 9 ms with Go on that route.

| Measurement                                  | Original client, Node | Updated client, Node | Updated client, Go |
| -------------------------------------------- | --------------------: | -------------------: | -----------------: |
| Fitted rotation lag between screens          |                 97 ms |                 5 ms |               9 ms |
| First visible turn: pilot / observer         |            2 / 102 ms |            4 / 23 ms |         20 / 36 ms |
| Observer minus pilot at left/right reversals |             82–100 ms |         −0.2–15.4 ms |       −1.5–17.9 ms |
| Same-time rotation RMS error                 |             0.198 rad |            0.016 rad |          0.021 rad |

These are localhost measurements, with no injected delay in the two-client
comparison. They are sampled render poses, rather than a physical monitor's
scanout or a subjective claim that all frames are perfect. The route uses a
short forward flight, then sixteen alternating left/right holds. Both actual
canvases retain the piloted ship during steering. The observer is zoomed out
so both ships remain visible. Source modules are obtained from the running
app's resource URLs, avoiding a second, unrendered NetworkClient instance.

The fitted lag shifts the observer's recorded rotation curve against the
pilot's curve and minimizes angular RMS error. First response is measured
separately: a good fit after a turn begins can hide a delayed initial response.
Reversal timing includes the ship's normal angular inertia on both screens.
Browser scheduling and server tick phase vary between runs; an earlier Go run
measured 5 ms fitted lag and a 40 ms first-response difference.

The initial longer-flight experiment measured 151 ms, but eventually moved the
ship farther from the observer. It was replaced by the matched nearby route
above. The original client was the working tree at the start of this task,
including the earlier uncommitted smoothness work, rather than Git HEAD.

The old renderer maintained its own history, an extra two-tick playback delay,
a jitter buffer, a variable-speed playback clock, and distance-based blending
into collision prediction. The simulation already predicted the remote ships.
Rendering that simulation directly removes both the constant delay and the
speed variation introduced by mixing the two timelines.

FramePrediction now copies the replicated world once per tick/checkpoint and
uses the existing shared full-tick physics endpoint and bounded pose
interpolation for every body. Remote ships and the pilot use the same timeline
at contact and in free flight. RemoteMotion only releases reconciliation error
with a short exponential correction. It has no snapshot history, playback
clock, drift samples, or distance-based handoff.

NetworkClient consumes pending snapshots on the next display frame, after
catching up elapsed simulation ticks. It also requests sprite refresh when a
snapshot is applied between ticks. The deliberate one-tick input lead and
extra startup tick are gone: they could schedule new controls into a future
server tick even on localhost. Input edges, rollback, the prediction horizon,
and coalescing received entity deltas remain.

Node and Go no longer emit ID-only heartbeat records for stationary player
ships. These only kept the old presentation history advancing. Both servers
now keep each receipt's sequence and send tick together, removing the separate
send-tick map. Adaptive backpressure remains: replacing it with a fixed nine
slots failed the 5 KiB/s downstream test by allowing seconds of stale state to
queue. With the retained protection that test has at most two queued packets
and recovers within five 60 Hz frames when bandwidth returns.

The three client files shrink from 1,229 to 827 lines, a reduction of 402 lines.
The production entry shrinks from 54,039 to 52,672 gzip-level-1 bytes (1,367 bytes,
2.5%). Its final raw size is 119,940 bytes. It still exceeds the repository's
existing 14 KB chunk target. Other final resources are docked UI 4,708 raw /
2,431 gzip bytes, sound 1,681 / 942, and the Node server 105,907 / 45,455.

A separate four-browser run used 40, 55, 70, and 85 ms artificial delays in each
direction. Every client observed all three peers. Average frame rates were
59.5–60.0 FPS, p95 frame intervals 16.7–16.8 ms, and measured position jumps at
packet receipt and reconciliation were zero. There were occasional 33–50 ms
browser frame intervals; this is not a guarantee against platform scheduling
stalls or a claim that delayed contacts can be predicted perfectly.

Deterministic tests exercise first response and alternating turns at 60 and
144 Hz, three server tick phases, and 0/10/40 ms delay in each direction. The
zero-delay observer's additional first-response delay stays below 35 ms.
With 40 ms in each direction the observer's initial response takes roughly
90–133 ms: prediction cannot reveal an input before it arrives. The tests
allow the actual network transit separately from the less-than-50-ms software
budget. Existing burst, outage, contact, docking, teleport, and short-tap stop
checks still exercise the shared presentation path.

The complete `npm test` and `npm run test:go` suites pass. Go/Node session parity
covers 748 decoded packets, including timed inputs, reconnect, catch-up, and
backpressure. Production builds pass. Lint passes with two existing
`no-new-array` warnings. The whole-repository formatting check still reports
six untouched experiment documents; changed files pass targeted formatting.
All browser processes and the test server/frontend pair were stopped afterward.

Run the browser response check with one server on port 3001 and Vite on port
3000, using the normal WebSocket proxy:

```sh
node benchmarking/tools/input-response-browser.mjs /tmp/response.json.gz
node benchmarking/tools/remote-browser.mjs /tmp/four-clients.json.gz
```

The response harness accepts an optional third argument for delay in each
direction. It saves its traces before asserting latency limits, so the original
buffered implementation can still be measured as a failing baseline. It also
asserts that both clients retain the ship throughout the steering sequence.

[Saved captures and before/after client sources](../../../benchmarking/experiments/2026-10-02/remote-motion/results/2026-10-02-input-response.json.gz)
contain the matched baseline, Node and Go results, and four-client capture.
The older analytic trajectory and passing-ship microbenchmarks now check pose
interpolation and the absence of distance-based blending. The old
remote-motion microbenchmark only measures sampling already-predicted poses;
its historical network-lag numbers are not comparable to this implementation.
Use the browser response harness and networked perspective tests for that.
