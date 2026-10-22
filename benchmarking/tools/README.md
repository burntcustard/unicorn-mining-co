# Benchmark tools

Run from the repository root. Node-server comparisons and runners depending on
its removed implementation have been retired. Historical reports and captures
remain under `benchmarking/experiments` and `benchmarking/archive`.

## Go session CPU

Build a session test executable, including the generated catalog:

```sh
npm run catalog:go
GOEXPERIMENT=simd go test -c -pgo=./src/server/default.pgo \
  -o /tmp/unicorn-session.test ./src/server/network
node benchmarking/tools/go-cpu.ts current /tmp/unicorn-session.test
```

The runner measures convoy, spread, contact and module workloads at 4/8/16/32
players, using the first two available physical cores, `GOMAXPROCS=2`, and
`GOGC=200` to match the current Fly configuration. Affinity limits parallelism;
it does not emulate Fly's shared CPU quota or burst balance.
`PLAYERS`, `WORKLOADS`, `TICKS`,
`REPETITIONS`, and `CPUSET` configure it. Its optional third argument is a previous
JSON or gzipped JSON result. Measurements include full session simulation and
packet construction with in-memory socket sinks, excluding real network latency.

For sequential alternating before/after executables:

```sh
node benchmarking/tools/go-cpu-paired.ts change BEFORE_EXECUTABLE AFTER_EXECUTABLE
```

Use `CPU_AFFINITY`, `PLAYERS`, `WORKLOADS`, `TICKS`, and `REPETITIONS` to configure
paired runs. Both variants default to the same GC setting. `BEFORE_GOGC` and
`AFTER_GOGC` allow an explicit GC experiment. For a future four- or eight-core
comparison, set both `CPU_AFFINITY` and `GOMAXPROCS`. Avoid concurrent builds or
browser captures during CPU measurement.

The paired runner removes each temporary result before execution and checks its
player/workload/tick metadata. A missing test or result fails the comparison.

For Linux instruction and branch diagnostics around the same workload:

```sh
go build -o /tmp/unicorn-go-perf ./benchmarking/tools/go-perf
GOGC=200 GOMAXPROCS=2 SESSION_RESULT=/tmp/counters-session.json \
  SESSION_PLAYERS=32 SESSION_TICKS=3000 SESSION_WORKLOAD=module \
  taskset -c 0,1 /tmp/unicorn-go-perf -o /tmp/counters.json \
  /tmp/unicorn-session.test -test.run '^TestSessionBenchmark$'
```

This reads inherited user-mode hardware counters, including startup, warmup and
small wrapper-thread overhead. It records enabled/running time for scaling and
reports unavailable counters. Generic cache events are hardware/kernel-specific;
do not interpret them as L3 misses without checking their mapping. Counter runs
and profiles are diagnostics, separate from ordinary CPU timing captures. See
the [compiler and instruction investigation](../../docs/experiments/2026-10-22/go-server-cpu-lowering.md).

Refresh the executable's PGO profile after package/function changes:

```sh
for workload in convoy spread contact module; do
  GOGC=200 GOMAXPROCS=2 SESSION_RESULT="/tmp/$workload.json" \
  SESSION_PLAYERS=32 SESSION_TICKS=3000 SESSION_WORKLOAD="$workload" \
  SESSION_CPU_PROFILE="/tmp/$workload.pprof" taskset -c 0,1 \
    /tmp/unicorn-session.test -test.run '^TestSessionBenchmark$'
done
go tool pprof -proto /tmp/convoy.pprof /tmp/spread.pprof \
  /tmp/contact.pprof /tmp/module.pprof > /tmp/server.pgo
cp /tmp/server.pgo src/server/default.pgo
```

`SESSION_CPU_PROFILE` excludes setup and warmup. Profile combat separately when
it is part of the target workload, and compare old/new PGO builds before keeping
the refresh. The [October 22 investigation](../../docs/experiments/2026-10-22/go-server-cpu.md)
records a mixed session/combat profile and held-out timing comparisons.

## Pirate combat CPU

`BenchmarkPirateCombat` runs one physically simulated player and one fighting
pirate through the normal session input, region, weapon, collision and snapshot
updates. Its open, normal and dense cases use generated sectors and fields at
30% player thrust. Additional normal-fast and dense-fast cases use full player
thrust with the same turns. The player sends repeatable flight/fire inputs;
enlarged ship health and ammunition
keep the encounter running. Fresh worlds and four-second warmups occur outside
measurement every 900 ticks, preventing benchmark calibration from exhausting a
field. The in-memory socket excludes TCP transport and timer scheduling.

Build before/after test executables from their respective sources with the same
generated catalog and production PGO profile:

```sh
GOEXPERIMENT=simd go test -c -pgo=./src/server/default.pgo \
  -o /tmp/pirate-after.test ./src/server/network
node benchmarking/tools/pirate-cpu.ts /tmp/pirate-before.test \
  /tmp/pirate-after.test benchmarking/local/pirate-cpu.json
```

The paired runner alternates before/after order for five repetitions of 9,000
ticks per case. It discovers case names from benchmark output and checks that both
variants run the same cases. It records process user plus system CPU as `cpu-ns/tick`, binary
hashes, build information, GC settings, scheduler width, allocation counts,
firing time and outgoing bytes. Speed, time inside the field and separation
metrics check that full-thrust cases remain meaningful chases. `TICKS`,
`REPETITIONS` and `GOGC` configure both
variants identically. The default `GOGC=200` matches `fly.toml`; standalone
server startup still defaults to 800. The runner uses the same two-core defaults
and affinity overrides as the session runners. Run timing comparisons without
concurrent builds, tests or profiles. The ordinary `ns/op` remains wall time.

For a separate dense-case diagnostic profile:

```sh
GOGC=200 GOMAXPROCS=2 taskset -c 0,1 /tmp/pirate-after.test -test.run '^$' \
  -test.bench '^BenchmarkPirateCombat/dense$' -test.benchtime=30000x \
  -test.cpuprofile=/tmp/pirate.pprof -test.memprofile=/tmp/pirate.mem
go tool pprof -top -cum -focus=tickSector -ignore=newPirateCombatBenchmark \
  /tmp/pirate-after.test /tmp/pirate.pprof
```

Profiles include fixture setup and warmup unless filtered as above; reported
CPU/tick excludes both. Inputs enter the session as decoded controls; binary
control decoding, TCP writes and timer scheduling are outside this benchmark.

## WebSocket transport

```sh
CGO_ENABLED=0 GOEXPERIMENT=simd go build -pgo=./src/server/default.pgo \
  -o /tmp/unicorn-transport ./benchmarking/tools/websocket-transport
GOGC=200 GOMAXPROCS=2 BENCH_CPU_AFFINITY=0,1 \
  node benchmarking/tools/websocket-transport.ts /tmp/unicorn-transport -game
```

The Go harness and Node client measure real framing/socket writes with the
browser binary codec. `ACK_DELAY_MS` adds acknowledgment delay;
`BENCH_CPU_AFFINITY` optionally pins the Go child. The comparison runner accepts
before/after transport executables; check its usage message for arguments.
Choose two available physical cores for the host; the example uses 0/1.

The client validates optional receipt requests, records receipt counts, and checks
packet order separately from simulation ticks. Undelayed measured snapshots must
advance one tick each; startup and delayed-receipt checks allow backpressure.

Linux kernel backpressure, partial-frame ordering, and receipt jitter checks run
with the integration tests. Run them separately, including the race detector, with:

```sh
GOEXPERIMENT=simd node benchmarking/tools/go-transport-check.ts --race
```

The PMU wrapper also records whole-child Linux `ProcessUsage`: CPU time, context
switches, and peak RSS (`Maxrss`, KiB). These include setup/warmup. PMU counters
remain user-mode only, including the wrapper thread and inherited child tasks.

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

Use `GAMEPLAY_NATIVE=1 GAMEPLAY_RESOLUTION=1920x1200` on a 1920 × 1200 display
for fullscreen captures without viewport emulation. Native mode verifies the
physical screen, viewport, and pixel density, rejecting mismatched dimensions.
Set `GAMEPLAY_RESOLUTION=3840x2160` for emulated 4K viewport/backing-canvas
captures. The physical display is recorded separately; oversized virtual
viewports do not represent native display performance. Results
include consecutive one-second FPS windows; `fps-windows[0]` is their minimum.
Set `GAMEPLAY_RENDERER=canvas` or `webgl` to compare the Graphics setting in
either browser. `auto` uses the app default. This affects only the owned profile.

Each scenario records host power policy before and after measurement and rejects
a policy change. On Linux this includes the power profile, CPU energy preference,
and online power sources. Unavailable values are recorded as `null` or an empty
source map. Compare captures made with the same power policy; plugged-in power
alone does not imply the Performance profile.

The runner opens an owned, visible browser on the primary display, verifies a
2560 × 1440 viewport and backing canvas at default zoom, and unlocks audio with
a trusted key event. It loads the built production CSS and asserts that gameplay
HUD panels remain visible, including in isolated worlds. Its default scenarios are normal-network flight, large
asteroid fractures, dense combat, continuous flight, and a minimal canvas
reference. Combat and flight equip an autogun with ten ammunition packs and
keep the searchlight active. The isolated
world uses the real simulation cadence and production property/tag transforms,
including separately emitted lazy chunks. Flight must move both ship and camera;
combat must consume ammunition and fracture rock. Flight recycles rocks already
outside the viewport before pose capture, and records the minimum, mean, and
final visible-rock count. Isolated radar contacts are rebuilt from that world's
asteroids each simulation step, and their count must match the scene. It closes
only its browser.

JSON results include rAF frame intervals, missed refreshes above 12.5 ms,
main-loop/update/prediction/message timings, canvas attributes, movement, audio
state, and activity checks. CPU tuples contain mean, p95, p99, and maximum
milliseconds. rAF is the application frame cadence, not a hardware scanout
measurement. Results default to ignored `benchmarking/local`.

`GAMEPLAY_SCENARIOS=live,large,combat,flight,reference` selects the scenarios.
Repeating `live` measures consecutive periods in
one browser without resetting the world. Each gameplay scenario activates the
owned browser tab. Captures reject browser errors, a page hidden during measurement,
and missing native CSS transforms. Browser evaluations time out after the capture
duration plus 20 seconds, including a reference canvas waiting for frames.
Do not run builds, other browser checks, or CPU
profiles alongside an acceptance capture.

Optional diagnostics:

- `GAMEPLAY_NO_HUD_BLUR=1`: disable HUD card backdrop blur to isolate its
  rendering cost. This changes appearance and is excluded from acceptance captures.
- `GAMEPLAY_SCREENSHOTS=1`: capture each scenario after its measurement.
- `GAMEPLAY_BASELINE=FULL_COMMIT_HASH`: compile that commit's client source
  without changing the checkout; specs must match the running Go server.
- `GAMEPLAY_GPU=1` / `GAMEPLAY_SOFTWARE=1`: override and verify the native
  Canvas foreground backing-store hint for a backend comparison. These flags
  apply to native Canvas rendering; explicit `webgl` selection uses WebGL2.
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

- `npm run benchmark` / `benchmark:headless`: 16 rendering diagnostics in Chrome.
  Start the standard Go server and Vite with
  `npm run dev -- --strictPort --mode benchmark` first. The runner reuses port
  3000 and its normal proxy; benchmark mode enables the rendering switches.
- `live.ts`, `live-suite.ts`, `live-browser-probe.ts`, `live-report.ts`: deployed
  game measurements; see [live instructions](../live/README.md).
- `input-response-browser.ts`, `remote-browser.ts`, `stall-browser.ts`: client
  input, presentation and outage checks with local Go on 3001 and Vite on 3000.
  The input runner accepts `OUTPUT.json.gz DELAY_MS [chrome|firefox]` and uses
  native browser WebSockets with delay in the development Vite proxy. Use
  `INPUT_RESPONSE_HEADFUL=1` for visible-window checks. It records DOM key time,
  completed-frame response, audio state, and browser errors; its latency limits
  remain unchanged. See the [input/startup report](../../docs/experiments/2026-10-18/input-startup-2026-10-18.md).
- `flight-resources.ts`: network resource observations.

Follow [the local browser workflow](../../.agents/skills/codebase-workflow/SKILL.md)
and stop owned processes when finished. Remaining numeric, polygon, physics and
remote-motion tools are offline diagnostics or comparisons of supplied artifacts.
Outputs from new investigations belong under ignored `benchmarking/local` until
curated; retained historical captures keep their original metadata and paths.
