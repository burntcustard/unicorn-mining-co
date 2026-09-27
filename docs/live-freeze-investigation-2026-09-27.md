# Live multiplayer freeze investigation — 27 September 2026

> Follow-up: both corrections are now implemented locally; see
> [fixes and verification](multiplayer-freeze-fixes-2026-09-27.md). The findings
> below describe the original investigation before those changes. Nothing has
> been deployed.

Three independent Chromium clients flew against https://unicorn-mining.co/ for
seven minutes. A second seven-minute run compared the deployed client, the local
prediction-limit removal, and a prototype snapshot timing correction. Both runs
used the live server. No server code was deployed or changed.

The recordings show **two distinct failures**. The three existing local patches
do not fix both, and the earlier tests which withheld packets missed a client bug
that occurs while packets are arriving normally.

## 1. Fresh snapshots arrive, but the client never applies them

At 215.7–217.1 seconds in the first flight, client 3 rendered at 60.3 FPS and
received 40 snapshots. Its received server tick advanced from 61290 to 61330.
Its applied tick remained 61269 and its predicted tick remained 61284. Its local
ship position did not change, although the authoritative ship moved 362.7 units.
Client 1 continued applying snapshots and moving during this interval.

A later occurrence, at 363.5–366.4 seconds, lasted 2.93 seconds without applying a
snapshot: 88 packets arrived, rendering stayed at 60.0 FPS, and the longest
packet gap was only 51.8 ms. Prediction itself stayed at one tick for a sampled
2.40 seconds. There were no client exceptions or socket closures in either run.

The cause is in `NetworkClient.updateFrame()` and `update()`:

1. `updateFrame` subtracts the unfinished frame remainder from `now`, producing
   the timestamp of the last whole simulation tick.
2. `update` accepts a pending snapshot only if that earlier timestamp is at or
   after `snapshotReceivedAt`.
3. A packet arriving between that tick boundary and the actual browser frame is
   deferred. The next packet can replace it before the next eligible boundary.
4. If the two clocks maintain that phase, the newest packet keeps moving the
   acceptance timestamp forward. No snapshot is applied, even with a healthy
   connection. The prediction limit then stops the ship.

One recorded update had a tick boundary of 218868.60 ms, packet reception at
218878.90 ms, and actual update execution at 218880.60 ms. The packet was already
available when the browser updated, but the older boundary caused it to be
rejected. Different browser phases explain why another player can remain smooth.

## 2. One connection receives an increasingly old stream

Near the end of the first flight, client 2 was in an asteroid field with 74
replicated entities. It received consecutive old ticks slowly, then received a
burst of queued ticks. Other clients continued receiving current ticks.

Measured over approximately 398–405 seconds:

| Client | Animation FPS | Snapshots/second | Received tick progression |
| ------ | ------------: | ---------------: | ------------------------- |
| 1      |          60.0 |             30.0 | 66764 → 66963             |
| 2      |          58.7 |              1.7 | 66749 → 66760             |
| 3      |          60.0 |             30.0 | 66764 → 66963             |

Client 2's stream fell as much as **279 ticks, or 9.3 seconds**, behind the
contemporaneous ticks seen by the other clients. Delivery recovered in a burst
around 408–410 seconds. Its packets were approximately 3,100 bytes each during
the slow interval; its preceding normal traffic was about 100 KiB/second.

This was not a common server simulation pause: the other clients' server ticks
kept advancing normally. The precise buffer or transport responsible is not
established. The second run also recorded browser transport timestamps; its
largest client-2 transport gap was 974 ms, matching the JavaScript message gap,
rather than showing a long receive-handler execution. The second run did not
repeat the full 9.3-second stream backlog.

`fly status --json` could not run because no Fly access token was available.
Consequently, the live server's `socket.bufferedAmount` was not measured.

## Assessment of the three existing local changes

| Local change                                                               | What the evidence supports                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the client's prediction limit                                       | Masks the motion freeze caused by the snapshot gate, but leaves authoritative snapshots unapplied. The client can continue predicting stale scenery and contacts. It does not clear a transport backlog or guarantee smooth corrections while old packets continue arriving. It is not a sufficient synchronization fix.                                                                                                                  |
| Apply severely early inputs immediately and remove the ±120-tick rejection | Useful for controls during a genuinely old stream. Client 2's predicted input tick was over 120 ticks behind the healthy clients' server tick from approximately 402.4 to 409.6 seconds. Under the old rule, a newly sent control with that timestamp would be discarded, despite its newer sequence. This run did not isolate the far-ahead-input branch as a cause. Neither branch repairs the client snapshot gate or packet delivery. |
| Skip snapshots when `socket.bufferedAmount` exceeds 128 KiB                | A reasonable mitigation if queued data reaches Node's reported socket buffer; preserving the last sent replication baseline is necessary and is present in the patch. It will not trigger for data already accepted by a kernel or proxy buffer. The live evidence confirms queued/stale delivery, but cannot prove this threshold would have been reached. This fix remains conditional, not a verified cure.                            |

## Isolated correction and comparison

The prototype uses the real frame time to decide snapshot eligibility on the
**last simulation update in that browser frame**, while retaining the original
tick-boundary timestamp for fractional movement. Earlier catch-up updates still
use their historical boundary. This prevents perpetual deferral without applying
a fresh snapshot at the beginning of several already elapsed simulation ticks.

The prototype retains the deployed prediction limit and unchanged server logic.
It was served only to one test browser by overriding its JavaScript response;
it was not applied to the working tree or deployed.

A deterministic ten-second test used 60 FPS rendering, 30 Hz snapshots, and
packets arriving 5 ms after each simulated boundary, before the actual frame:

| Client variant                                         | Snapshots' final tick | Final applied tick | Final predicted tick | Paused frames after warm-up |
| ------------------------------------------------------ | --------------------: | -----------------: | -------------------: | --------------------------: |
| Deployed                                               |                   300 |                  0 |                   15 |                         480 |
| Current local prediction-limit removal                 |                   300 |                  0 |                  302 |                           0 |
| Prototype timing correction, original prediction limit |                   300 |                300 |                  302 |                           0 |

This directly distinguishes hiding the freeze from processing current server
state. The prototype also passed the original server-lag regression scenarios:
33.3, 100 and 200 ms server intervals, including 100 ms browser frames and bounded
recovery from actual packet outages.

In the second seven-minute live flight:

| Client variant              | Average FPS | Pending-snapshot updates skipped by the gate | Maximum received minus applied ticks |
| --------------------------- | ----------: | -------------------------------------------: | -----------------------------------: |
| Deployed                    |       58.50 |                                        7,219 |                                   23 |
| Prediction limit removed    |       58.25 |                                        5,330 |                                   19 |
| Prototype timing correction |       59.94 |                                            0 |                                    4 |

A short pending-tick difference is expected between message delivery and the next
simulation update. The prototype had no repeated gate deferral. These clients
flew different routes, so these figures are evidence about snapshot application,
not a controlled rendering-performance comparison or a guarantee against all
network stalls.

The next source change should correct snapshot eligibility. The input rejection
change has independent value for long stream lag. The buffer mitigation needs
server-side measurements during another backlog before it can be credited with
fixing that transport problem. Simply removing the prediction bound should not
be treated as resolving synchronization.

## Evidence and reproduction details

- [Compact results and selected timing samples](../benchmarking/results/2026-09-27-live-freeze-investigation.json).
- [Video: snapshot application starvation](/tmp/unicorn-freeze-live/snapshot-starvation.webm).
- [Video: delayed stream in an asteroid field](/tmp/unicorn-freeze-live/slow-stream.webm).
- Full videos and samples: `/tmp/unicorn-freeze-live/` and `/tmp/unicorn-freeze-compare/`.
- Browser harnesses and deterministic reproduction: `/tmp/unicorn-freeze-browser/`.
- Prototype source: `/tmp/unicorn-phase-network.ts`; isolated regression bundle:
  `/tmp/unicorn-phase-test.mjs`.
- Chromium 153.0.8010.12, Playwright 1.63.0, three separate browser processes and
  profiles, 1280×800 viewports, 960×600 video, observation samples about every
  250 ms. Pilots held thrust, steered periodically, and enabled drill and light.
- Deployed asset: `index-D6NvqTEq.js`, SHA-256
  `a4cf103ad2f250498f140b112f58b99600980249df1bfc90af97757b67b2823a`.
- Observation wrappers exposed state and timing, preserving method results and
  exceptions. They did not delay, reorder, or replace WebSocket packets. Recording
  and observation add some client work and can affect exact scheduling phase.
- All investigation browser processes were closed. The three existing source/test
  changes were left intact. This investigation adds only this report and its
  result data; production resource sizes are unchanged by the investigation.
