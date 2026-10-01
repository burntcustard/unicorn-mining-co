# Go / Node session benchmark — 2026-09-30

See the [2026-10-01 follow-up comparison](go-server-cpu-comparison-2026-10-01-followup.md)
for the latest three-way results, including 32-player scenarios. This document
preserves the earlier measurements.

For the latest **Go before/current optimization comparison**, including all 16
scenarios through 32 players, see the
[2026-10-01 CPU comparison](go-server-cpu-comparison-2026-10-01.md).

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

See [port layout and local running instructions](../GO_PORT.md). The raw [main Node results](../../benchmarking/main-node-server-results.json) record the source revision and unchanged harness hash. The original [per-run results](../../benchmarking/go-server-results.json) include CPU, memory, latency tails, event counts, and encoded-byte totals. The runner and both harnesses are `benchmarking/go-server.mjs`, `benchmarking/session.ts`, and `internal/server/session-benchmark_test.go`.

Fly memory, live play over WAN, and CPU-quota throttling still need checking after the user's merge/deployment. Keep the preceding Fly image available for rollback; deployment still resets the in-memory world.

## `go fix` follow-up — 2026-10-01

Running `go fix ./...` with Go 1.27.1 simplified integer loops, embedded-field
struct literals, reverse slice iteration, and string splitting. A second pass
inlined snapshot-fixture pointer helpers as `new(value)`; the unused wrappers
were then removed. The reverse iterator's generated variable name and imports
were tidied. A final `go fix -diff ./...` reports no further changes. These
changes improve readability, with **no clear change in session performance**.
The allocation-saving `strings.SplitSeq` in WebSocket header handling runs
during connection setup, outside the measured simulation ticks.

As requested, the comparison uses **one measured run per version, player count,
and workload**, rather than the ten repetitions above. Original and fixed
`internal/server` test executables were compiled separately, then run sequentially
on logical CPU 0 with `GOMAXPROCS=1`. Execution order alternated by workload.
Each process used seed 25, 120 warmup ticks, and 900 measured ticks, with tracing
disabled. Builds and tests finished before measurement. The baseline is
`9742a1074509db3b4e08e2f41b78296ed97b60fe`; the original historical samples above
were not reused or overwritten.

| Players | Workload | Before CPU ms/tick | After CPU ms/tick | CPU change |
| ------- | -------- | -----------------: | ----------------: | ---------: |
| 4       | convoy   |           0.050730 |          0.048690 |     -4.02% |
| 4       | spread   |           0.119721 |          0.119274 |     -0.37% |
| 4       | contact  |           0.065873 |          0.066090 |     +0.33% |
| 4       | module   |           0.185983 |          0.189024 |     +1.64% |
| 8       | convoy   |           0.101948 |          0.099494 |     -2.41% |
| 8       | spread   |           0.213228 |          0.209732 |     -1.64% |
| 8       | contact  |           0.118980 |          0.118451 |     -0.44% |
| 8       | module   |           0.387954 |          0.388550 |     +0.15% |
| 16      | convoy   |           0.237016 |          0.236790 |     -0.10% |
| 16      | spread   |           0.464800 |          0.463877 |     -0.20% |
| 16      | contact  |           0.237039 |          0.238719 |     +0.71% |
| 16      | module   |           0.975167 |          0.974713 |     -0.05% |

Summing CPU across the four equally long workloads gives **+0.18% at 4 players,
-0.72% at 8 players, and +0.00% at 16 players**. Differences are small and mixed;
one sample cannot distinguish these from process variation. All twelve pairs
matched exactly on contacts, consequential and near-zero events, packet counts,
encoded-byte totals, entity counts, and final ship states. This timed comparison
does not trace individual packets; the Go/TypeScript parity suite separately
checks decoded packets and complete sessions.

The [raw before/after results](../../benchmarking/results/2026-10-01-go-fix.json)
retain CPU, RSS, heap, latency tails, outcome counts, final-state hashes,
executable hashes, and execution order. To reproduce, compile the original
and fixed source versions with `go test -c -o <executable> ./internal/server`,
then invoke each executable once for every player count and workload:

```sh
GOMAXPROCS=1 SESSION_PLAYERS=4 SESSION_WORKLOAD=convoy SESSION_TICKS=900 \
  SESSION_TRACE= CONTACT_TRACE= SESSION_RESULT=/tmp/session-result.json \
  taskset -c 0 /tmp/session-benchmark -test.run '^TestSessionBenchmark$'
```

Repeat with 8 and 16 players and `spread`, `contact`, and `module`, alternating
which version runs first. Choose the same allowed logical CPU for both versions.

Validation passed: `npm run test:go`, production builds before and after,
Go formatting, and `git diff --check`. The simulation and snapshot-decoding
checks also passed after the manual cleanup. `npm run lint` completed with two
existing `unicorn(no-new-array)` warnings in TypeScript replication code.
Client resources are unchanged: entry 113,950 bytes / 50,317 gzip bytes,
docked chunk 4,708 bytes, sound chunk 1,681 bytes, and Node server 99,220 bytes.
The existing entry-size warning remains. Static Go builds also pass. With the
Docker build flags (`CGO_ENABLED=0`, `-trimpath`, and `-ldflags='-s -w'`), the Go
executable grows from 7,811,232 to 7,815,328 bytes: +4,096 bytes (+0.05%). The
baseline build used an overlay restoring the original Go source files.
