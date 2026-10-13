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
browser binary codec. `ACK_DELAY_MS` adds acknowledgment delay;
`BENCH_CPU_AFFINITY` optionally pins the Go child. The comparison runner accepts
before/after transport executables; check its usage message for arguments.

## Browser and live checks

For full-resolution gameplay measurements, keep the standard Go/Vite services
running, finish the build, and run one browser at a time:

```sh
npm run dev:server
npm run dev -- --strictPort
npm run build
node benchmarking/tools/gameplay-performance.ts chrome 30
node benchmarking/tools/gameplay-performance.ts firefox 30
```

Set `GAMEPLAY_RESOLUTION=3840x2160` for native 4K fullscreen captures. Results
include consecutive one-second FPS windows; `fps-windows[0]` is their minimum.
Set `GAMEPLAY_RENDERER=canvas` or `webgl` to compare the Graphics setting in
either browser. `auto` uses the app default. This affects only the owned profile.

The runner opens an owned, visible browser on the primary display, verifies a
2560 × 1440 viewport and backing canvas at default zoom, and unlocks audio with
a trusted key event. Its default scenarios are normal-network flight, large
asteroid fractures, dense combat, continuous flight, and a minimal canvas
reference. Combat and flight equip an autogun with ten ammunition packs and
keep the searchlight active. The isolated
world uses the real simulation cadence and production property/tag transforms,
including separately emitted lazy chunks. Flight must move both ship and camera;
combat must consume ammunition and fracture rock. Flight recycles rocks already
outside the viewport before pose capture, and records the minimum, mean, and
final visible-rock count. It closes only its browser.

JSON results include rAF frame intervals, missed refreshes above 12.5 ms,
main-loop/update/prediction/message timings, canvas attributes, movement, audio
state, and activity checks. CPU tuples contain mean, p95, p99, and maximum
milliseconds. rAF is the application frame cadence, not a hardware scanout
measurement. Results default to ignored `benchmarking/local`.

`GAMEPLAY_SCENARIOS=live,large,combat,flight,reference` selects the scenarios.
Repeating `live` measures consecutive periods in
one browser without resetting the world. Captures reject browser errors and
missing native CSS transforms. Do not run builds, other browser checks, or CPU
profiles alongside an acceptance capture.

Optional diagnostics:

- `GAMEPLAY_SCREENSHOTS=1`: capture each scenario after its measurement.
- `GAMEPLAY_BASELINE=FULL_COMMIT_HASH`: compile that commit's client source
  without changing the checkout; specs must match the running Go server.
- `GAMEPLAY_GPU=1` / `GAMEPLAY_SOFTWARE=1`: override and verify the native
  Canvas foreground backing-store hint for a backend comparison. These flags
  apply to Firefox's native renderer; Chrome uses WebGL2 when available.
- `GAMEPLAY_NO_LIGHTEN=1`: replace interior lightening with source-over for
  diagnosis; this changes appearance and is excluded from acceptance captures.
- `GAMEPLAY_PROFILE=1`: capture Firefox's native profiler through its
  [documented BiDi extension](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html#profiler-module).
  Profiler runs have additional overhead and are diagnostic captures.
- `GAMEPLAY_TRACE=1`: save a compressed Chrome trace with GPU raster, swap,
  compositor, and main-thread events beside the JSON result. Tracing also adds
  overhead; use separate ordinary runs for acceptance.

After building, `UI_DOCK_ONLY=1 UI_GRAPHICS_ONLY=1 npm run test:ui` compares
production-transformed world rendering with native Canvas interior pixels.
It covers clipping, holes, blending, gradients, uploads, and frame order.
Set `UI_HEADFUL=1` to run UI checks on the real display GPU; the default
headless Chrome uses a software graphics backend on this device.

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
