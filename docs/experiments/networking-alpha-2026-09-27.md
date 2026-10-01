# Networking follow-ups for the public alpha

The adaptive-buffer implementation and its client measurements below are
historical. It is superseded by the [simpler one-tick buffer](networking-buffer-2026-09-27.md),
which limits additional buffering to 33.33ms. Shared encoding and the nearby-audio
design below still apply.

The target workload is now 4, 8, and 16 players. The server comparison defaults
to those populations across convoy, spread-out flight, contact-heavy flight, and
nearby module use. The module route operates drills, cargo hatches, and shields.
The existing admission limit is unchanged; these measurements guide the alpha
workload rather than justify a larger connection limit.

This follows the [initial nengi investigation](networking-nengi-2026-09-27.md)
and uses the same pinned `rc/2.0.0` source at
[`d78047ca62bf801af58e48f4b0ebb15065612d88`](https://github.com/timetocode/nengi/tree/d78047ca62bf801af58e48f4b0ebb15065612d88).
The comparison baseline includes the previous spatial index and socket lookup.

## Shared entity encoding

`SnapshotEncoder` lives for one synchronous snapshot batch. Entity records that
enter visibility can share their prepared full representation. Receivers at the
same immediately preceding entity revision can share the same delta object and
its JSON encoding. Each entity fragment is serialized once per encoder and
inserted into the appropriate receiver's packet.

The whole packet remains receiver-specific: acknowledged input, snapshot receipt
sequence, input timing feedback, visible IDs, and load/snapshot type are encoded
for that receiver. Different prior revisions follow the existing delta builder.
Replacing an object under an existing ID also follows that path so old optional
fields are cleared according to each receiver's history. Skipped sends do not
advance any baseline. Caches expire at the batch boundary, so no encoded fragment
survives a later world mutation. Shared records must not be edited by callers or
encoded after that boundary.

Packets with fewer than two entity records use the ordinary encoder. The JSON
array marker is generated from a literal property key so the production property
rewrite remains consistent. A replacement callback preserves literal dollar
sequences in user strings. The normal JSON encoder still handles escaping,
Unicode, numbers and `null` clears. There is no new wire format or client decoder.

The implementation adapts the prepared-fragment idea from
[`sharedEntityFragments.ts`](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/binary/snapshot/sharedEntityFragments.ts).
A general map of every receiver revision cost more at alpha populations in the
initial experiment. The implemented cache covers the common previous revision;
it leaves uncommon histories to the existing comparison code. An instrumented
eight-player convoy run put JSON encoding at about 5% of total CPU, so replacing
JSON wholesale would have a limited benefit in that workload.

All 72 server runs produced identical packets and final state. The largest
median CPU increase was 3.75%; every case passed the 10% gate. Results are
mixed: contact/module workloads can benefit, while spread-out groups have less
shared state and pay a small encoding overhead. No bandwidth reduction is claimed.

| Players | Route   | Before CPU ms/tick | After CPU ms/tick | Change |
| ------- | ------- | -----------------: | ----------------: | -----: |
| 4       | convoy  |             0.4329 |            0.4308 | -0.49% |
| 4       | spread  |             0.6104 |            0.6333 | +3.75% |
| 4       | contact |             0.5698 |            0.5132 | -9.94% |
| 4       | modules |             0.9167 |            0.9302 | +1.48% |
| 8       | convoy  |             0.8095 |            0.8131 | +0.45% |
| 8       | spread  |             1.4737 |            1.5215 | +3.24% |
| 8       | contact |             0.8621 |            0.8857 | +2.73% |
| 8       | modules |             1.9441 |            1.8824 | -3.17% |
| 16      | convoy  |             1.6277 |            1.6469 | +1.17% |
| 16      | spread  |             3.3728 |            3.4873 | +3.40% |
| 16      | contact |             2.1643 |            2.1384 | -1.19% |
| 16      | modules |             2.8149 |            2.7256 | -3.17% |

The largest median peak RSS increase was 7.7% in the
8-player spread case (313.5 to 337.8 MiB).
Peak RSS includes the warm cycle and V8 collection timing; it is not a retained
heap or long-running memory bound. Per-run memory and GC data are saved.

## Adaptive arrival buffering

`RemoteMotion` measures the excess packet-arrival gap over the actual server tick
span. Using the tick span prevents a steady 10 Hz or 5 Hz server cadence from
being mistaken for network jitter. A rolling window of 20 gaps supplies a target
of at most three extra simulation ticks (100ms). Gaps above 250ms are excluded so
a suspended tab or long outage does not train a huge buffer.

The target grows promptly after significant jitter and decays at 10ms per second
after two seconds of calmer observations. Steady links keep the existing
interpolation delay and four-pose history. Once jitter is detected, tracks retain
at most eight poses. A shared render clock advances each track at 90–110% of
normal speed to approach the target without reversing its playback cursor. A
large forward error after an outage can skip obsolete presentation history.
Docking and teleports reset the affected track; reconnect resets timing history.
Missing snapshots still hold their last endpoint instead of extrapolating.

This adapts nengi's
[adaptive delay policy](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/client/InterpolationDelayPolicy.ts)
and [playback cursor](https://github.com/timetocode/nengi/blob/d78047ca62bf801af58e48f4b0ebb15065612d88/src/client/PlaybackCursor.ts)
to the game's entity tiers and existing contact blending. Physics, local input,
authoritative snapshot application, and immediate receipt acknowledgements keep
their existing timing. Nearby collision poses still come from shared prediction;
the delay applies to remote presentation in free flight.

All 15 client workload medians passed the CPU gate. The largest increase was
8.15%. CPU below is normalized per simulated render frame, including receipt
processing and deterministic fixture playback.

| Players | Delivery | Before CPU µs/frame | After CPU µs/frame | Change |
| ------- | -------- | ------------------: | -----------------: | -----: |
| 4       | steady   |               4.560 |              4.745 | +4.06% |
| 4       | jitter   |               4.600 |              4.870 | +5.88% |
| 4       | burst    |               4.508 |              4.816 | +6.83% |
| 4       | slow     |               4.158 |              4.267 | +2.62% |
| 4       | outage   |               4.536 |              4.761 | +4.96% |
| 8       | steady   |               5.253 |              5.423 | +3.23% |
| 8       | jitter   |               5.215 |              5.640 | +8.15% |
| 8       | burst    |               5.214 |              5.601 | +7.44% |
| 8       | slow     |               4.756 |              4.929 | +3.64% |
| 8       | outage   |               5.218 |              5.470 | +4.83% |
| 16      | steady   |               6.749 |              7.041 | +4.33% |
| 16      | jitter   |               6.787 |              7.327 | +7.96% |
| 16      | burst    |               6.789 |              7.246 | +6.74% |
| 16      | slow     |               6.079 |              6.256 | +2.91% |
| 16      | outage   |               6.762 |              7.009 | +3.66% |

The quality figures below match across the three populations. Stalls count
render frames with no progress during the final 25 seconds. Mean lag includes
the base delivery delay, presentation buffering and frame sampling.

| Delivery | Stalls before → after | Mean lag before → after | Mean speed change before → after |
| -------- | --------------------: | ----------------------: | -------------------------------: |
| steady   |                 0 → 0 |          73.3 → 73.3 ms |        0.00 → 0.00 m/s per frame |
| jitter   |               139 → 0 |         98.2 → 146.1 ms |       90.45 → 5.16 m/s per frame |
| burst    |               248 → 0 |         86.3 → 171.6 ms |       54.63 → 2.13 m/s per frame |
| slow     |                 0 → 0 |        140.0 → 140.0 ms |        0.00 → 0.00 m/s per frame |
| outage   |               59 → 59 |          93.4 → 93.4 ms |        9.70 → 9.70 m/s per frame |

Jitter and burst traces have zero stalled frames after settling and much lower
speed variation. The tradeoff is extra presentation latency. All traces retain
forward playback; the one-second outage still holds its endpoint as intended.

## Future nearby sound delivery

No audio behavior or audio packet fields are added here. The following constraints
should guide that work:

- Keep engine/drill loops and durable module state within normal spatial state
  replication. Existing thrust and module state can drive those loops without
  sending a new packet for every sound frame. Current state enters at 2,000m and
  exits at 2,500m to avoid repeated visibility churn; the exit margin does not
  extend hearing range. Station markers at 10–11km also convey no audio interest.
- Send transient collision, hatch and shield transition events only to nearby
  authorized listeners. Give each event an identity, authoritative tick, source
  and event-time position. Encode an event payload once if useful, then select
  recipients independently. Do not attach a global event list to a shared packet.
- Apply a strict 2,000m audio cutoff. Server selection should use an authoritative
  listening position, normally the controlled ship. If free camera movement
  later changes that position, define and validate that subscription explicitly.
  The client applies the final cutoff and attenuation from its actual camera
  centre; a remote source should not remain audible just because its entity is
  retained in the 2,500m hysteresis margin.
- A starting gain curve is `0.5 * max(0, 1 - distanceFromCamera / 2000)` for remote
  sounds, relative to the equivalent local sound. This is a proposed linear gain
  curve; it is not a claim that half amplitude is half perceived loudness.
- Timestamp remote cues so they can follow the delayed remote presentation.
  Local predicted cues should remain immediate and be deduplicated against
  their authoritative event. A loop ends when its source unloads or leaves the
  audible range.
- Transient events need a separate bounded lifetime and delivery policy. A state
  snapshot may skip intermediate states under backpressure; an open/close pair
  or collision can disappear if treated as ordinary coalesced entity state.
  Conversely, replaying stale impacts after a long outage is undesirable. Define
  a short expiry and an event sequence independently of the state revision cache.

This also keeps state visibility distinct from permission: a nearby craft's
public animation can be shared without broadcasting inventory transactions or
input commands. The current implementation shares serialization work only after
receiver visibility has been selected.

## Measurement and validation

Server runs use the production compiler/property mapping, real simulation and
replication, and socket stubs that serialize and hash packets. There are three
sequential alternating before/after repeats per population and route. Every run
has a complete warm cycle, then 300 warm-up and 1,800 measured ticks. The check
requires equal packet hashes, byte counts, packet counts, entity counts, and
final positions, and rejects any workload median CPU increase above 10%.

Client runs also compile the actual presentation code with the production
property mapping. Each fixture represents one client among 4/8/16 players plus
32 scenery tracks, with the players flying together. It replays 30 seconds at
60 render frames/second and 30 snapshots/second (10 for the slow case), with a
40ms base delivery delay. Seeded jitter adds up to 55ms; the burst case delays one
packet in twelve by 90ms; the outage case holds delivery for one second.
Generation and compilation are outside timing. Timed replays include packet
feeding, predicted pose setup, receive processing and pose sampling, but exclude
browser rendering, audio, real transport and client snapshot decoding.

There are three alternating before/after process pairs. Each process first primes
all five delivery paths with ten untimed replays at 16 players. Each measured
case then has five warm replays and five CPU samples of ten replays per process. The acceptance check
uses the median of the 15 samples per variant/case and the same 10% limit. Quality
measurement discards the first five seconds, checks forward motion and bounded
lag, and compares stalls and frame-to-frame speed changes. Steady, slow, and
outage fixtures must retain identical output; jitter/burst fixtures must improve
both stalls and speed variation. This is a controlled motion trace, not an FPS
or end-to-end Internet latency measurement.

An earlier client comparison failed the 10% gate in the first four-player steady
case (+15.43%). Its first-case CPU blocks varied substantially. The failed
samples are retained in the results. The final implementation separates adaptive
advancement from the small steady-link path, and the final comparison primes all
delivery paths equally for both variants. The CPU gate describes warmed gameplay;
it does not bound startup compilation costs.

The production builds, typecheck, lint, simulation/snapshot tests, server/lag
integration tests, reconnect, prediction, real WebSocket packet tests, and
production lazy-chunk/property-mangling tests pass. New tests compare shared
encoding byte-for-byte against regular JSON and full-scan snapshots through
skipped updates, visibility changes, field clears, ID replacement and escaped
strings. Motion tests cover the seeded conditions, long gaps, endpoint holding,
docking, teleports, unloading and reset. Existing collision tests check both
pilots' presentation against the shared physics solution.

Changed-file formatting and formatting-rule tests pass. The repository-wide
format check still flags the unchanged baseline files
`benchmarking/session-tick.mjs` and
`benchmarking/results/2026-09-27-numeric-representations.json`.

Production resource changes from the preceding implementation, in bytes:

| Resource     | Before raw | After raw | Raw change | Before gzip-1 | After gzip-1 | Gzip change |
| ------------ | ---------: | --------: | ---------: | ------------: | -----------: | ----------: |
| HTML         |       3986 |      3986 |          0 |          1952 |         1949 |          -3 |
| Client entry |      97133 |     97965 |       +832 |         43129 |        43517 |        +388 |
| Docked       |       4740 |      4740 |          0 |          2445 |         2445 |           0 |
| Sound        |       1681 |      1681 |          0 |           942 |          942 |           0 |
| Server       |      82654 |     83143 |       +489 |         35753 |        35938 |        +185 |

No dependency or loading trigger changed. The existing entry-chunk gzip budget
warning remains. The sound and docked chunks retain their separate loaders.

Measured on Intel(R) Core(TM) Ultra X7 358H, Node v26.5.0, with no CPU affinity.
[Raw results, the failed comparison, exact baseline sources and source hashes](../../benchmarking/results/2026-09-27-alpha-networking.json)
are saved as a reproducible measurement artifact. Do not run builds or other
CPU-heavy work alongside the comparisons.

Restore only the saved benchmark baseline into a temporary directory:

```sh
node --input-type=module <<'JS'
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
const result = JSON.parse(readFileSync('benchmarking/results/2026-09-27-alpha-networking.json', 'utf8'));
mkdirSync('/tmp/alpha-baseline', {recursive:true});
for (const [name, source] of Object.entries(result.baselineSources)) writeFileSync('/tmp/alpha-baseline/' + name, source);
JS
node benchmarking/production-flight.mjs --network-baseline=/tmp/alpha-baseline --save=/tmp/alpha-before.mjs --ticks=30 --players=4 --scenario=convoy
node benchmarking/production-flight.mjs --save=/tmp/alpha-after.mjs --ticks=30 --players=4 --scenario=convoy
node benchmarking/compare-networking.mjs --before=/tmp/alpha-before.mjs --after=/tmp/alpha-after.mjs --output=/tmp/alpha-server.json
node benchmarking/remote-motion.mjs --baseline=/tmp/alpha-baseline/remote-motion.ts --save=/tmp/motion-before.mjs
node benchmarking/remote-motion.mjs --save=/tmp/motion-after.mjs
node benchmarking/compare-remote-motion.mjs --before=/tmp/motion-before.mjs --after=/tmp/motion-after.mjs --output=/tmp/alpha-client.json
```

Both server variants use the same current production name mapping, allowing
exact wire comparisons. No workspace source needs to be replaced to benchmark
the previous networking implementation.
