# Benchmark tools

Run from the repository root. Node-server comparisons and runners depending on
its removed implementation have been retired. Historical reports and captures
remain under `benchmarking/experiments` and `benchmarking/archive`.

## Go session CPU

Build a session test executable, including the generated catalog:

```sh
npm run catalog:go
GOEXPERIMENT=simd go test -c -o /tmp/unicorn-session.test ./src/server/network
node benchmarking/tools/go-cpu.ts current /tmp/unicorn-session.test
```

The runner measures convoy, spread, contact and module workloads at 4/8/16/32
players, using a shared CPU affinity. `PLAYERS`, `WORKLOADS`, `TICKS`,
`REPETITIONS`, and `CPUSET` configure it. Its optional third argument is a previous
JSON or gzipped JSON result. Measurements include full session simulation and
packet construction with in-memory socket sinks, excluding real network latency.

For sequential alternating before/after executables:

```sh
node benchmarking/tools/go-cpu-paired.ts change BEFORE_EXECUTABLE AFTER_EXECUTABLE
```

Use `CPU_AFFINITY`, `PLAYERS`, `WORKLOADS`, `TICKS`, and `REPETITIONS` to configure
paired runs. Avoid concurrent builds or browser captures during CPU measurement.

Refresh the executable's PGO profile after package/function changes:

```sh
SESSION_RESULT=/tmp/session.json SESSION_PLAYERS=8 SESSION_TICKS=900 \
SESSION_WORKLOAD=module GOEXPERIMENT=simd go test \
  -run '^TestSessionBenchmark$' -cpuprofile=/tmp/server.pgo \
  -o /tmp/unicorn-profile.test ./src/server/network
cp /tmp/server.pgo src/server/default.pgo
```

## WebSocket transport

```sh
CGO_ENABLED=0 GOEXPERIMENT=simd go build -pgo=./src/server/default.pgo \
  -o /tmp/unicorn-transport ./benchmarking/tools/websocket-transport
node benchmarking/tools/websocket-transport.ts /tmp/unicorn-transport -game
```

The Go harness and Node client measure real framing/socket writes with the
browser binary codec. `ACK_DELAY_MS` adds acknowledgement delay;
`BENCH_CPU_AFFINITY` optionally pins the Go child. The comparison runner accepts
before/after transport executables; check its usage message for arguments.

## Browser and live checks

- `npm run benchmark` / `benchmark:headless`: Vite benchmark mode and Chrome.
- `live.ts`, `live-suite.ts`, `live-browser-probe.ts`, `live-report.ts`: deployed
  game measurements; see [live instructions](../live/README.md).
- `input-response-browser.ts`, `remote-browser.ts`, `stall-browser.ts`: client
  input, presentation and outage checks with local Go on 3001 and Vite on 3000.
- `flight-resources.ts`: network resource observations.

Follow [the local browser workflow](../../.agents/skills/codebase-workflow/SKILL.md)
and stop owned processes when finished. Remaining numeric, polygon, physics and
remote-motion tools are offline diagnostics or comparisons of supplied artifacts.
Outputs from new investigations belong under ignored `benchmarking/local` until
curated; retained historical captures keep their original metadata and paths.
