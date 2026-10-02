# Remote movement smoothness follow-up — 2026-10-02

The first presentation fix removed instantaneous reconciliation jumps. This
follow-up tests motion between display frames, every player's perspective,
bidirectional latency, omitted stationary deltas and packet stalls.

## Further causes and changes

The contact handoff used a fixed 25-unit band to blend from buffered movement
into current prediction. At high speed, the difference between those poses
exceeded the band. A ship could appear to speed up on approach and travel
backwards on departure despite constant authoritative velocity.

The band now grows to three times the pose difference, with a 25-unit minimum.
Cubic easing makes its boundaries smooth. Proximity uses the closest point on
the segment between buffered and predicted positions, avoiding a cusp when the
nearest endpoint changes. The handoff still reaches full shared prediction
before hulls can touch, and its position remains between the two known poses.
The fractional prediction world includes this wider area around the pilot;
subsequent contact-chain expansion retains its previous reach.

Stationary ships omitted from delta snapshots also stopped advancing their
playback clocks. When movement restarted, their histories could lag by seconds
and eventually lose the displayed endpoint. Omitted samples now advance from the
last sampled free motion, including zero velocity and docked state. A long gap
between one entity's changed records is distinguished from a gap in snapshot
progress. A regression leaves a ship stationary for three seconds and checks
continuous, timely movement on restart.

The playback clock previously recovered from bursts at double speed, then held
at an endpoint. It now changes speed gradually within 90–110% of normal speed.
An arrival-variation buffer adds at most three simulation ticks (100 ms), with a
roughly two-second decay of the measured variation. Long stalls reset this
estimate. Steady delivery retains the two-tick schedule. A final history-overrun guard
resets playback when a long outage discards the endpoint still being displayed,
preventing a stalled queue from taking seconds to drain. Outages still hold
at the newest known endpoint without extrapolating an unknown turn.

Both servers previously allowed just two unacknowledged snapshots, limiting
30 Hz delivery to roughly a 67 ms round trip. They now start with two slots and
expand to nine after an ordinary snapshot receipt demonstrates a round trip
within eight simulation ticks. The extra slot covers tick phasing. Slower
receipts reduce the window to two again; initial loads do not qualify for
expansion. Existing byte-buffer limits, cumulative acknowledgement validation,
connection resets and delta-baseline rules continue to apply.

## Validation workloads

`tests/remote-handoff.test.ts` checks 120 constant-speed pass-bys: 120 and
272 units/s, five separations, 40/90 ms downstream delay, both travel directions,
and 30/60/144 Hz display rates. Both objects also move vertically together.
The fixed handoff permits no backwards movement, no speed above 1.51 times the
flight speed, and no frame-to-frame speed change above 30% of flight speed.

`tests/remote-perspectives.test.ts` uses real clients, binary deltas,
acknowledgements, prediction and the TypeScript authoritative session. Every
client's view of every other player is sampled. Paired ships encounter heavy
asteroids, then turn and can bump into other ships. Transport preserves FIFO in
both directions and varies latency by client. Profiles cover steady 80–160 ms
round trips, additional deterministic jitter, and repeated 80 ms packet stalls.
It tests 60 and 144 Hz displays. The default regression runs four clients;
the comparison runs 4, 8, 16 and 32 clients. Both performance and idle clocks
are mocked, so CPU scheduling cannot affect the replay.

The before/after comparison runs three independent processes per version.
Each process covers 120 pass-bys, 20 playback-clock cases and 24 multiplayer
collision cases. Independent replays may run concurrently because their clocks
are deterministic. Browser capture runs after those processes finish.

The baseline is the working source after the first collision-presentation fix.
The archive retains both versions' complete source, hashes and individual runs:
[raw smoothness comparison](../../benchmarking/results/2026-10-02-remote-smoothness.json.gz).
Its embedded baseline can be reused without a separate Git commit:

```sh
node benchmarking/remote-smoothness.mjs \
  benchmarking/results/2026-10-02-remote-smoothness.json.gz \
  /tmp/remote-smoothness-recheck.json.gz
REMOTE_PLAYERS=4,8,16,32 npm run test:prediction
```

Snapshot cadence tests in both languages verify 30 Hz over 67–267 ms round
trips and bounded two-slot behavior for slower receipts. The artificial
5 KiB/s receiver still peaks at two queued snapshots and recovers in 100 ms
when bandwidth returns. Healthy clients remain unaffected. The Go and Node
session parity test passes across 748 decoded packets, including timed inputs,
reconnect, catch-up and backpressure; Go snapshots decode through the client.

## Results and browser check

All three repetitions produce identical results within each version. In the
multiplayer replay, **every client observes every peer**, including all 31 peers
in the 32-client cases. Packet-arrival discontinuities fall from 22.095611 world
units to zero. Snapshot-application displacement stays below 0.000000458 units;
that residual is below the renderer's existing one-millionth-unit pruning cutoff.
Every delivery profile now sends one snapshot per simulation tick in this replay,
where the old window produced gaps of up to seven ticks.

Frame roughness is the RMS change in displacement between adjacent display
frames. It includes physical contacts and turns. The ranges below cover the
three delivery profiles at each display rate:

| Players | Roughness reduction at 60 Hz | Roughness reduction at 144 Hz |
| ------: | ---------------------------: | ----------------------------: |
|       4 |                   83.1–85.5% |                    33.8–54.8% |
|       8 |                   83.3–88.7% |                    57.1–65.6% |
|      16 |                   83.0–87.1% |                    67.7–70.5% |
|      32 |                   81.8–86.7% |                    70.8–73.6% |

The constant-speed handoff tests isolate the presentation effect: backwards
frames fall from 476 to zero across 120 cases, maximum apparent horizontal speed
falls from 3.793 to 1.494 times flight speed, and maximum frame-to-frame speed
change falls from 273% to 9.1% of flight speed. Increasing snapshot delivery also
changes input-clock scheduling and thus some paths through contacts; the
whole-scene roughness comparison includes that effect. Authoritative collision
rules are unchanged.

In the isolated 30-second clock replay, the burst profile has zero stalled
frames instead of 124, and mean speed change falls from 21.40 to 0.23 units/s.
Its mean presentation delay grows from 112.8 to 187.4 ms. Jitter grows from 114.2
to 161.9 ms; steady delivery remains 106.7 ms, including the fixture's 40 ms
one-way delay. Slow sampling remains smooth with a 173.3 ms mean delay.

The broad comparison precedes the final history-overrun guard. A separate
[three-run outage comparison](../../benchmarking/results/2026-10-02-remote-outage-recovery.json.gz)
verifies that guard at 4/8/16/32 entities: in the one-second-outage profile,
stalled frames fall from 201 to 57, mean delay falls from 267.3 to 125.4 ms and
mean speed change falls from 51.61 to 9.38 units/s. Every other clock-profile
measurement matches exactly. Prediction regressions are rerun afterward.

Four isolated Chrome windows then exercise the real development canvas app,
using the standard server/proxy pair, actual keyboard thrust/turn controls and
40/55/70/85 ms delay in **each** network direction. All four observe the other
three active players. Receipt and reconciliation jumps are zero in every
window. Each records 727–729 displayed frames at 59.8–59.9 fps, with a
16.7–16.8 ms 95th-percentile frame gap. Rare maximum gaps are 33.3–50 ms,
including screenshot capture. The trace retains per-frame poses:
[raw browser recording](../../benchmarking/results/2026-10-02-remote-browser.json.gz).
Chrome and the two test servers are stopped afterward.

The browser harness resolves the app's loaded module URLs, including Vite's
cache-busting query, and checks that it instruments the rendered player's
network instance. Its receipt comparison pins both samples to one timestamp;
otherwise normal movement during instrumentation would be miscounted as a jump.
The browser check uses the TypeScript dev server; Go's wire/session behavior
and delayed cadence are checked separately. These workloads do not establish
smoothness for arbitrary packet loss or an indefinitely stalled browser.

## Builds and checks

The complete `npm test`, Go package tests and Go session/snapshot parity checks
pass. Type-aware lint retains the two existing `no-new-array` warnings. Changed
files pass formatting; repository-wide formatting still flags six existing
experiment reports.

Relative to the first presentation fix, the client entry grows from
121,545 / 53,432 to 121,973 / 53,612 bytes (raw / gzip level 1):
**+428 raw bytes and +180 gzip bytes**. The Node server grows from
105,795 / 45,389 to 105,968 / 45,504 bytes: +173 raw and +115 gzip bytes.
Docked and sound remain 4,708 / 2,432 and 1,681 / 942 bytes (raw / gzip).

The jitter buffer intentionally trades some presentation delay for steadier
motion during uneven delivery. Rendering-only reconciliation offsets still
settle independently from physics. The tests distinguish these visual choices
from changes to authoritative collision rules, which are unchanged.
