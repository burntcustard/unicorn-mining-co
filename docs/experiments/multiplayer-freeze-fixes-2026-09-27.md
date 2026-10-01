# Multiplayer freeze fixes — 27 September 2026

Both corrections are implemented in the working tree. Nothing has been deployed.
The [live investigation](live-freeze-investigation-2026-09-27.md) records the two
failures that motivated these changes.

## Changes

- **Snapshot starvation:** the last simulation step in a browser frame checks
  snapshot eligibility against the actual frame time. Earlier catch-up steps keep
  their historical timestamps, and fractional movement keeps its original tick
  boundary. A continuous stream of packets can no longer keep postponing the
  newest snapshot indefinitely.
- **Delivery backlog:** a client negotiates receipt acknowledgements at connection
  setup. The server sends at most two unacknowledged snapshots to that player,
  counting initial loads, dock updates, and respawn loads. The browser acknowledges
  decoded state even when rendering is paused. This bounds outstanding updates
  beyond Node's socket buffer, including queues in the kernel, proxy, or browser.
  Once capacity returns, the server computes a current snapshot from the last
  state actually sent; skipped ticks do not advance the delta baseline.
- **Inputs and recovery:** retained the existing correction that accepts new input
  sequences even when a client's tick is far behind/ahead. Replaced unlimited
  prediction with the original bound. A genuine delivery outage still limits
  speculative simulation; removing the cap was masking stale state.
- **Lifecycle:** acknowledgements validate connection-local sequences, cannot
  acknowledge an unsent packet, and do not reset the player idle timer. Reconnect
  resets the window. Respawn loads wait for capacity rather than being lost.

The flow-control window trades snapshot frequency for freshness on slow links.
Two outstanding snapshots sustain 30 Hz with round-trip delivery within roughly
66 ms; higher latency reduces snapshot frequency while client prediction
continues. This prevents a growing stale stream, but cannot make a disconnected
or severely bandwidth-limited link deliver current world state instantly. The
original live backlog's exact location remains unknown; the fix does not depend
on it appearing in `ws.bufferedAmount`.

Client and server should be built and released together. A client without the
acknowledgement capability retains the original send behavior and will not get
the new backlog protection until updated.

## Regression results

`tests/server-lag.test.ts` now covers:

- Three clients with snapshots arriving 5 ms before, 5 ms after, and 9 ms after
  the simulated boundary, at 60 FPS/30 Hz: all 300 snapshots apply over ten
  seconds, ships move, and search lights fully activate.
- Three clients with one downstream link replaying the observed approximately
  3.1 KB packet size at 5 KiB/s. The simulated proxy accepts writes immediately,
  so `bufferedAmount` stays zero. Small isolated-world packets are padded to the
  recorded packet size; this is a controlled transport reproduction.
- Ten-second asymmetric outages, stale input/module activation on the server,
  recovery with correct deltas, and bounded prediction history.
- Invalid/duplicate receipts, idle accounting, dock updates, deferred respawn
  loads, and replacement connections.

| Throttled downstream   | Largest queued snapshots |       Largest delay | Recovery after restoring 100 KiB/s |
| ---------------------- | -----------------------: | ------------------: | ---------------------------------- |
| Original send behavior |                      341 | 341 ticks / 11.37 s | Still behind after one second      |
| Receipt flow control   |                        2 |    54 ticks / 1.8 s | 6 frames / 100 ms                  |

The other two clients had zero applied-tick delay in both controlled runs.
The capped stream's 1.8-second worst delay includes the deliberately restricted
link; it does not accumulate with the length of the restriction.

Passed: production build/typecheck, type-aware lint, simulation/snapshot tests,
server tests, prediction tests, reconnect tests, input tests, and packet tests.
The packet test uses separately built client encoding and the real built server
and verifies acknowledgement negotiation and continued snapshot delivery.
Legacy backlog coalescing remains tested explicitly with flow control disabled.

## Production sizes

Compared with the local three-patch working tree at the start of this fix;
gzip sizes use Node zlib at level 1.

| Resource     | Before raw | After raw | Before gzip | After gzip |
| ------------ | ---------: | --------: | ----------: | ---------: |
| Main client  |   96,966 B |  97,133 B |    43,102 B |   43,157 B |
| Server       |   81,539 B |  81,813 B |    35,237 B |   35,390 B |
| Docked chunk |    4,740 B |   4,740 B |     2,446 B |    2,445 B |
| Sound chunk  |    1,681 B |   1,681 B |       942 B |      942 B |

The main bundle's existing 14 KB gzip warning remains. Loading triggers are
unchanged. New application properties and the appended `snapshotAck` tag are
shortened consistently in both production bundles.

## Three-browser verification

Three separate Chromium processes flew the full local game for 75 seconds using
the default Vite WebSocket proxy and one game server. Client 1's message callbacks
were held for ten seconds, then limited to one delivery every 600 ms for fifteen
seconds. Client 2's callbacks were also held for ten seconds, overlapping that
restriction. Client 3 received normally throughout. These holds intentionally
simulate an outage; movement during the hold is limited by bounded prediction.

After normal delivery resumed at 35 seconds, both affected clients were current
by the 35.116-second sample. Their queues peaked at two snapshots. All three
finished on server tick 8558, with no browser errors and 58.7–59.4 average FPS.
After recovery, received snapshots were at most two ticks ahead of application.
One sample immediately before applying a post-outage snapshot had a 298-tick
difference; this cleared on the next sampled frame and did not recur as
starvation. The scene reached 66 visible entities during the run.

- [Browser result summary](../../benchmarking/results/2026-09-27-freeze-fixes-browser.json).
- Raw samples and screenshots: `/tmp/unicorn-freeze-fixed/final/`.
- Harness: `/tmp/unicorn-freeze-browser/local-fixes.mjs`.

An earlier browser attempt was interrupted by a development reload, and another
needed its observation hook updated for Vite's cache-busting URL. Those attempts
are excluded from the successful run above. All test browsers and local server
processes have been stopped. This verifies the local changes; a production
deployment and follow-up live run have not occurred.
