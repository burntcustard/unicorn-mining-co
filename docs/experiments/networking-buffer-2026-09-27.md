# One-tick remote motion buffer

The previous adaptive buffer could add up to 100ms and produced 172ms mean lag
in the burst fixture. It is replaced by a fixed allowance of **one simulation
tick (33.33ms)**, with a simple playback clock. This follows the user's preference
for responsiveness and small, inexpensive code.

## Implementation

RemoteMotion advances its existing render cursor by elapsed frame time, stops at
the newest received pose, and clamps forward to at least the old arrival-based
target minus one tick. The monotonic cursor and that lower bound keep it at most
one tick behind the original interpolator's cursor. Late packets can cause a
stall or a forward correction rather than build a larger buffer. Total network
latency and the entity's existing replication interval are separate.

The source diff against the original interpolator is 14 added lines and two
changed/removed lines, including comments. Compared with the superseded adaptive
implementation it removes 89 lines and adds 16. Only one extra timestamp is kept
for the whole sampler; the original four-frame history remains. There is no
arrival window, jitter calculation, decay timer, or speed adjustment. The extra
allowance is always one simulation tick, even for slower entity update tiers.

Local input prediction, physics, contact-pose blending, shared encoding, and
packet formats retain their existing behavior. Stops and short turns are checked
against an exact two-tick schedule on steady 30 Hz delivery: one existing
interpolation tick plus the one extra tick. Teleports, docking, unloads,
reconnection, and outages are covered by tests.

## Latency and smoothness

These are **total simulated motion ages**, including 40ms base server-to-client
delivery. They are not full player-input-to-other-screen measurements. All three
populations have the same deterministic quality results. Stalls count stationary
render frames over the final 25 seconds of a continuously moving trace.

| Delivery | Original lag ms | Previous adaptive lag ms | Current lag ms | Stalls original → current |
| -------- | --------------: | -----------------------: | -------------: | ------------------------: |
| steady   |            73.3 |                     73.3 |          106.7 |                     0 → 0 |
| jitter   |            98.2 |                    146.1 |          114.2 |                   139 → 0 |
| burst    |            86.3 |                    171.6 |          112.4 |                 248 → 124 |
| slow     |           140.0 |                    140.0 |          133.3 |                     0 → 0 |
| outage   |            93.4 |                     93.4 |          125.4 |                   59 → 57 |

The worst mean additional lag over the original is 33.33ms on steady delivery.
On jitter it adds about 16ms; on bursty delivery about 26ms. The jitter fixture
retains zero stalls. The burst fixture accepts 124 stalled frames rather than
paying the previous buffer's extra latency. One-second outages still hold the
newest known pose; no buffer can supply missing state.

The same simple clock was explored with zero, half, and one tick of buffering:

| Extra allowance ms | Delivery | Mean lag ms | Stalls |
| -----------------: | -------- | ----------: | -----: |
|                  0 | jitter   |        95.9 |    196 |
|                  0 | burst    |        84.6 |    248 |
|              16.67 | jitter   |       104.7 |     56 |
|              16.67 | burst    |        98.2 |    186 |
|              33.33 | jitter   |       114.2 |      0 |
|              33.33 | burst    |       112.4 |    124 |

The 33.33ms setting removes ordinary-jitter stalls and halves burst stalls relative
to the zero-allowance clock. Those exploratory runs are retained, but their CPU
samples do not contribute to the final comparison.

## CPU

Original means the pre-adaptive interpolator. Previous means the superseded
100ms adaptive implementation. All 15 cases must pass the 10% CPU gate against
both. The comparison also checks non-reversing playback, no increase in stalls,
lower jitter/burst speed variation, and mean and maximum lag increases of at
most 33.33ms against the original. Outages are included in the lag checks.

CPU figures are median microseconds per simulated render frame, including receive
processing and predicted-pose setup. Three process repetitions rotate the three
variants through each position. Each process warms all delivery paths, then each
case, and measures five blocks of ten replays: 15 CPU samples per variant/case.
All use the production compiler/property mapping and a 16 MiB semi-space.

| Players | Delivery | Original µs/frame | Previous µs/frame | Current µs/frame | vs original | vs previous |
| ------: | -------- | ----------------: | ----------------: | ---------------: | ----------: | ----------: |
|       4 | steady   |             4.634 |             4.707 |            4.566 |      -1.45% |      -2.97% |
|       4 | jitter   |             4.568 |             4.839 |            4.535 |      -0.71% |      -6.27% |
|       4 | burst    |             4.551 |             4.787 |            4.545 |      -0.14% |      -5.07% |
|       4 | slow     |             4.221 |             4.276 |            4.153 |      -1.63% |      -2.89% |
|       4 | outage   |             4.563 |             4.736 |            4.542 |      -0.45% |      -4.09% |
|       8 | steady   |             5.280 |             5.460 |            5.311 |      +0.58% |      -2.73% |
|       8 | jitter   |             5.272 |             5.695 |            5.339 |      +1.28% |      -6.25% |
|       8 | burst    |             5.257 |             5.751 |            5.286 |      +0.55% |      -8.09% |
|       8 | slow     |             4.803 |             4.890 |            4.763 |      -0.82% |      -2.60% |
|       8 | outage   |             5.304 |             5.393 |            5.285 |      -0.36% |      -2.01% |
|      16 | steady   |             6.833 |             7.014 |            6.799 |      -0.49% |      -3.06% |
|      16 | jitter   |             6.815 |             7.362 |            6.910 |      +1.40% |      -6.13% |
|      16 | burst    |             6.764 |             7.347 |            6.873 |      +1.61% |      -6.46% |
|      16 | slow     |             6.104 |             6.325 |            6.138 |      +0.57% |      -2.94% |
|      16 | outage   |             6.826 |             6.995 |            6.792 |      -0.49% |      -2.90% |

These Node fixtures run on Intel(R) Core(TM) Ultra X7 358H with Node v26.5.0.
They exclude browser rendering, audio, real sockets and snapshot decoding.
They establish this workload's CPU and motion behavior, not Internet latency or FPS.

## Validation and size

Pre/post production builds and typecheck, lint, formatting tests, remote-motion
and two-client prediction tests, built/source packet tests, and docked/lazy-chunk
property mapping checks pass. The prediction test includes both pilots seeing
matching contact geometry. Its existing scenery interpolation checks move one
tick later to enforce the intended new schedule.

Compared with the superseded adaptive build, client JavaScript changes from
97,965 to 97,233 bytes raw, and 43,517 to 43,195 bytes at gzip level 1 (-322 bytes).
HTML is unchanged raw and +1 gzip byte. Docked and sound chunks retain their
sizes. Server JavaScript remains 83,143 bytes raw; gzip changes by -11 bytes due
to shared name mapping. Dependencies and loading triggers are unchanged.

[Raw samples, exact baseline sources, candidate explorations and hashes](../../benchmarking/results/2026-09-27-motion-buffer.json)
are retained. The earlier [alpha report](networking-alpha-2026-09-27.md) is historical
for client buffering; its server and nearby-audio work still applies.

## Reproduce

Run sequentially with builds and other heavy tests stopped:

```sh
node --input-type=module <<'JS'
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
const result = JSON.parse(readFileSync('benchmarking/results/2026-09-27-motion-buffer.json', 'utf8'));
mkdirSync('/tmp/motion-baselines', {recursive:true});
for (const [name, source] of Object.entries(result.baselineSources)) writeFileSync('/tmp/motion-baselines/' + name + '.ts', source);
JS
node benchmarking/remote-motion.mjs --baseline=/tmp/motion-baselines/original.ts --save=/tmp/motion-original.mjs
node benchmarking/remote-motion.mjs --baseline=/tmp/motion-baselines/previous.ts --save=/tmp/motion-previous.mjs
node benchmarking/remote-motion.mjs --save=/tmp/motion-current.mjs
node benchmarking/compare-remote-motion.mjs --before=/tmp/motion-original.mjs --after=/tmp/motion-current.mjs --previous=/tmp/motion-previous.mjs --output=/tmp/motion-comparison.json
```
