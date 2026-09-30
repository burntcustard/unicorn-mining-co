# Go / Node session benchmark — 2026-09-30

## Result

On this host, Go used **2.30–4.94× less CPU per simulation tick** across the twelve workloads. This exceeds the initial 2× hypothesis for these complete-session workloads. It is not a measurement of production Fly CPU quota, network RTT, or WebSocket framing costs.

Each cell below is the median of ten independent process runs. CPU is milliseconds for the whole server session per tick, including all players, region synchronization, simulation, contacts, module rules, per-player delta construction, binary encoding, and acknowledgement processing. Memory is peak process RSS in MiB. `main` is `dc1cf4191f2b54488bfa1962eba1b3db7680afed`, measured separately with the unchanged harness and dependencies; existing branch-Node/Go samples were retained without rerunning. “Branch vs main CPU” is `(branch Node / main Node − 1) × 100%`; negative means less CPU on this branch.

| Players | Workload | Branch Node CPU ms/tick | Go CPU ms/tick | Branch Node / Go CPU | main Node CPU ms/tick | main Node / Go CPU | Branch vs main CPU | Branch Node RSS MiB | Go RSS MiB | main Node RSS MiB |
| ------- | -------- | ----------------------: | -------------: | -------------------: | --------------------: | -----------------: | -----------------: | ------------------: | ---------: | ----------------: |
| 4       | convoy   |                   0.223 |          0.048 |                4.60× |                 0.232 |              4.79× |              -4.0% |               186.4 |       32.1 |             185.6 |
| 4       | spread   |                   0.570 |          0.120 |                4.74× |                 0.594 |              4.95× |              -4.2% |               197.3 |       34.1 |             198.2 |
| 4       | contact  |                   0.326 |          0.066 |                4.94× |                 0.340 |              5.16× |              -4.2% |               190.6 |       31.6 |             189.5 |
| 4       | module   |                   0.763 |          0.189 |                4.03× |                 0.817 |              4.31× |              -6.7% |               195.7 |       35.5 |             196.0 |
| 8       | convoy   |                   0.456 |          0.100 |                4.57× |                 0.483 |              4.84× |              -5.6% |               194.2 |       35.8 |             200.5 |
| 8       | spread   |                   0.752 |          0.212 |                3.55× |                 0.808 |              3.82× |              -7.0% |               196.0 |       38.8 |             201.4 |
| 8       | contact  |                   0.485 |          0.118 |                4.09× |                 0.504 |              4.26× |              -3.9% |               196.5 |       33.5 |             192.4 |
| 8       | module   |                   1.199 |          0.389 |                3.08× |                 1.577 |              4.05× |             -24.0% |               204.5 |       38.2 |             208.6 |
| 16      | convoy   |                   0.811 |          0.236 |                3.43× |                 0.867 |              3.67× |              -6.4% |               197.6 |       39.8 |             195.5 |
| 16      | spread   |                   1.070 |          0.465 |                2.30× |                 1.095 |              2.36× |              -2.3% |               212.2 |       40.8 |             214.2 |
| 16      | contact  |                   0.791 |          0.241 |                3.28× |                 0.826 |              3.43× |              -4.3% |               197.7 |       36.8 |             196.3 |
| 16      | module   |                   2.278 |          0.987 |                2.31× |                 2.490 |              2.52× |              -8.5% |               218.0 |       43.9 |             221.6 |

## Tick latency and outcomes

Latency entries are median per-run p95/p99 wall-clock tick durations in milliseconds. Maxima are the worst individual ticks across all ten runs. They are tick-processing latency, not network latency. Contacts count ordered pre-solve callbacks, including repeated callbacks for multiple fixtures and continuous collision passes; they are not unique body pairs.

| Players | Workload | Branch Node p95 / p99 ms | Go p95 / p99 ms | main Node p95 / p99 ms | Branch Node max ms | Go max ms | main Node max ms | Branch/Go contacts/run | main contacts/run | Snapshots/run (all) |
| ------- | -------- | -----------------------: | --------------: | ---------------------: | -----------------: | --------: | ---------------: | ---------------------: | ----------------: | ------------------: |
| 4       | convoy   |            0.718 / 3.360 |   0.104 / 0.262 |          0.719 / 3.660 |             11.752 |     1.850 |           12.378 |                      0 |                 0 |                1800 |
| 4       | spread   |            3.010 / 9.016 |   0.239 / 0.429 |          3.032 / 9.276 |             18.311 |     1.791 |           22.355 |                   1291 |              1291 |                1800 |
| 4       | contact  |            1.836 / 4.693 |   0.128 / 0.174 |          2.051 / 5.213 |             14.960 |     1.246 |           14.674 |                  14958 |             14958 |                1800 |
| 4       | module   |            3.246 / 6.974 |   0.393 / 0.593 |          3.293 / 7.192 |             15.869 |     2.136 |           16.087 |                  10583 |             11663 |                1800 |
| 8       | convoy   |            2.967 / 6.413 |   0.212 / 0.691 |          2.985 / 6.931 |             36.017 |     1.680 |           28.319 |                    640 |               640 |                3600 |
| 8       | spread   |            3.267 / 8.445 |   0.418 / 0.719 |          3.380 / 8.170 |             18.925 |     1.182 |           18.152 |                   2435 |              2435 |                3600 |
| 8       | contact  |            2.993 / 5.912 |   0.216 / 0.295 |          3.034 / 6.001 |             17.158 |     1.376 |           17.181 |                  29916 |             29916 |                3600 |
| 8       | module   |            3.919 / 8.120 |   0.829 / 1.797 |          4.813 / 8.622 |             17.656 |     2.826 |           22.243 |                  23873 |             30608 |                3600 |
| 16      | convoy   |            3.622 / 8.779 |   0.691 / 1.364 |          3.894 / 9.113 |             27.905 |     2.932 |           39.394 |                   3195 |              3195 |                7200 |
| 16      | spread   |            3.720 / 6.585 |   0.815 / 2.066 |          3.744 / 6.648 |             15.448 |     4.740 |           18.324 |                  24309 |             24309 |                7200 |
| 16      | contact  |            3.258 / 7.160 |   0.446 / 1.056 |          3.315 / 7.399 |             23.345 |     1.968 |           18.298 |                  59832 |             59832 |                7200 |
| 16      | module   |            5.479 / 8.332 |   2.140 / 3.204 |          6.125 / 9.160 |             15.457 |     5.162 |           15.270 |                  53435 |             53203 |                7200 |

The existing branch-Node/Go measured repetitions agreed on contact counts, consequential event counts, entity counts, packet counts, and resulting ship state. The separate traced runs compared **50,400 decoded snapshots**, including membership, fields, deltas, module/cargo state, and acknowledgements. Ordered collision events above numerical zero were also compared. Numeric differences across the parity runs were bounded by **4.67e-11**, below the `2e-8` absolute comparison tolerance.

Raw collision event counts are not bit-identical:

- 4-player module: Node [6], Go [5] near-zero collision notifications per measured run.
- 16-player module: Node [38], Go [42] near-zero collision notifications per measured run.

These separated impacts are at most `2e-8`, do no damage, and do not alter packets. Initial diagnostics observed extra impacts around `9e-16` to `1e-12`. Client collision presentation starts at impact 40. The harness records them explicitly as `nearZeroCollisions`; it does not change or suppress events in either server. Other collision event ordering and payloads are checked using the same numeric tolerance.

## Method

- CPU: AMD Ryzen 7 5800X3D 8-Core Processor; affinity fixed to logical CPU 0 for both runtimes. Go uses `GOMAXPROCS=1`.
- Runtimes: Node v26.8.2; go version go1.27.1 linux/amd64.
- Seed 25; 4, 8, or 16 connected players; procedural region loading remains enabled.
- Convoy: ships spaced 120 units apart; spread: 5,000 by 2,000-unit spacing; contact: opposing pairs 65 units apart; module: ships with nearby drilling targets and hatch/light transitions. Fresh targets are added ahead of surviving ships every 120 measured ticks so drilling continues after warmup.
- Every process performs hello/setup and 120 warmup ticks, then 900 measured ticks at the fixed 30 Hz simulation step. The workload runs as fast as possible; ordinary snapshots retain the 15 Hz simulation cadence.
- Ten measured repetitions per runtime/workload, alternating which runtime runs first. Convoy, spread and contact were measured in one batch; module cases were rerun with replenished targets on the same host and affinity. A separate instrumented run checks packets and events before the timed repetitions. Its trace allocations and serialization are excluded from timing and memory summaries.
- Both in-memory socket sinks perform snapshot-sequence decoding and equivalent acknowledgements. Binary packet construction is included; operating-system WebSocket I/O and external clients are excluded.
- CPU uses process user plus system CPU time. Peak RSS comes from `/proc/self/status` (`VmHWM`), avoiding pre-exec memory inherited from the benchmark parent. Live heap and all per-run samples are retained in the raw results. No forced collection or adjusted GC settings.
- Compilation, startup, hello, warmup, artifact writing, and comparison are outside the timed interval.

Branch Node and Go use eight-decimal velocity rounding; unmodified `main` does not. Module contact, event, and entity outcomes differ on `main`, so its module CPU ratios also reflect different simulated work; the raw results retain those counts. Main contact, consequential event, and entity counts match the branch in the other nine workloads; snapshot counts match in all twelve. Main results were deterministic across all ten repetitions per workload.

## Browser and build checks

- Production client in Chrome against Go: rendered flight, input, and page-reload reconnect; 163 received WebSocket frames, no runtime exceptions.
- Development client: zero corrections over 250 predicted ticks, including six seconds of turning flight. Reconnect recorded one reconciliation with zero positional correction.
- Sixteen concurrent real WebSocket connections and invalid-message closes pass the Go race detector.
- TypeScript prediction regression: 630 predicted ticks, 17 corrections, worst positional correction 0.429 units in its delayed-snapshot scenario.
- Built client entry: 113.95 kB, 50,317 bytes gzip level 1 (21 gzip bytes above the turn's baseline). The existing 14 kB entry-chunk warning remains; lazy docked and sound chunks remain 4.70 kB and 1.68 kB.
- Static Go binary builds without CGO. Docker's final image contains the Go executable and assets, with no Node runtime. No image was deployed and no code was committed.

## Reproduce

With Node dependencies installed and Go on PATH:

```sh
npm run test:go
npm run benchmark:go
```

See [port layout and local running instructions](GO_PORT.md). The raw [main Node results](../benchmarking/main-node-server-results.json) record the source revision and unchanged harness hash. The original [per-run results](../benchmarking/go-server-results.json) include CPU, memory, latency tails, event counts, and encoded-byte totals. The runner and both harnesses are `benchmarking/go-server.mjs`, `benchmarking/session.ts`, and `internal/server/session-benchmark_test.go`.

Fly memory, live play over WAN, and CPU-quota throttling still need checking after the user's merge/deployment. Keep the preceding Fly image available for rollback; deployment still resets the in-memory world.
