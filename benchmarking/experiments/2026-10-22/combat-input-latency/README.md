# Combat input latency evidence

See the [report](../../../../docs/experiments/2026-10-22/combat-input-latency.md)
for findings, comparisons, and measurement limits.

`results/combat-response-final-headful-*.json.gz` are the four matched browser
captures: `before`, `after`, `delay50`, and `delay100`. Delay is one-way
milliseconds. Each contains 20 steering and 20 ready-autogun trials in two real
visible-window Chrome clients. The pilot keeps the ordinary view size; the
observer zooms out. All trials, actual projectile/effect draws, input messages,
acknowledgments, and completed frames remain available. These are Vite development
modules, not the separate production-asset live acknowledgment suite.

`results/browser-summary.json` derives first-frame counts and frame timing from
those captures. Its original local input paths are retained. To regenerate it,
copy `sources/summarize-final-combat.ts.txt` to a `.ts` scratch file and pass the
four retained gzip paths as arguments. No browser is needed for analysis.

`results/exploratory/` holds earlier probe development captures. They use a
different view setup and lack the final flash/birth instrumentation. In
particular, the early global-ID metric rejected valid reused prediction IDs.
They are diagnostic evidence, excluded from the matched acceptance table.

`combat-cpu-{before,after}.json.gz` compare normal control workloads. The `late-`
pair injects two overdue edges per normal input event; `late16-` injects sixteen.
Each uses 4/32 players, 900 measured ticks after 120 warmup ticks, three repeats,
fixed physical cores, `GOMAXPROCS=2`, and `GOGC=200`. The executables use the same
current harness; their hashes, CPU affinity, and environment are embedded. The
before server includes the prior bounded-receipt fix and predates overdue-edge
preservation. Its source and snapshot tests are retained here.

`combat-input-authority.json.gz` is a separate 144-sample native WebSocket phase
sweep against the final server through the ordinary proxy. It checks applied
thrust as well as acknowledgment. Current and next-tick targeting differ by one
tick; this is not a before/after server speedup. `server-notes.md` retains the
commands and all CPU stress rows. `resource-sizes.json` records final build sizes.

## Repeat the current browser measurement

Follow the project's local-service workflow: inspect and reuse existing services.
The combat fixture requires a local server configured with a compiler overlay
and a temporary database. When starting the missing standard services:

```sh
node benchmarking/tools/combat-fixture.ts /tmp/unicorn-combat-fixture
GOGC=200 GOMAXPROCS=2 GOFLAGS=-overlay=/tmp/unicorn-combat-fixture/overlay.json DATABASE_PATH=/tmp/unicorn-combat-fixture/world.sqlite npm run dev:server
```

In a separate terminal, start the missing frontend with `npm run dev -- --strictPort`.
The normal ports and proxy remain 3000/3001. After both services are ready:

```sh
INPUT_RESPONSE_HEADFUL=1 COMBAT_RESPONSE=1 node benchmarking/tools/input-response-browser.ts benchmarking/local/combat-current.json.gz 0 chrome
INPUT_RESPONSE_HEADFUL=1 COMBAT_RESPONSE=1 node benchmarking/tools/input-response-browser.ts benchmarking/local/combat-delay100.json.gz 100 chrome
```

The fixture changes initial docking only. Equipment purchase, fitting, ammo,
launch, activation, charging, input, simulation, and draw paths remain real. Each
capture uses new browser profiles. Complete builds before capture; run CPU tests
separately. The runner closes its own browsers. Stop temporary services when
finished; preserve pre-existing user services.

For the browser baseline, load the archived `before-` client source files through
a Vite `enforce: 'pre'` load hook using their original module IDs. Keep the normal
input module (already changed to keydown), the final measurement probe, and the
same docked-spawn server fixture. `before-vite.config.ts.txt` preserves the actual
temporary config and workspace paths used. When replaying against the final tree,
also overlay `objects/projectile.ts`, whose follow-up changed after the baseline.
Do not mix the CPU before server with the browser before client: the matched
browser captures intentionally hold the final server input fix constant.

## Repeat the CPU comparison

Compile the current network test executable normally. For the baseline compiler
overlay, map `game-session.go` and `snapshot-cadence_test.go` to the retained
`before-` sources, and map `input-late_test.go` to a scratch file containing only
`package network`. Keep the current benchmark harness in both executables.

```sh
CGO_ENABLED=0 GOEXPERIMENT=simd go test -c -o /tmp/combat-after.test ./src/server/network
PLAYERS=4,32 WORKLOADS=convoy,contact,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-after.json node benchmarking/tools/go-cpu.ts combat-after /tmp/combat-after.test
SESSION_LATE_BURST=2 PLAYERS=4,32 WORKLOADS=convoy,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-taps.json node benchmarking/tools/go-cpu.ts combat-taps /tmp/combat-after.test
node benchmarking/tools/input-authority.ts ws://localhost:3000/game-socket benchmarking/local/combat-authority.json.gz
```

The CPU executables use no spawn fixture. Source snapshots use `.txt` suffixes so
they cannot join builds or linting. Result payloads and source snapshots are
immutable; `manifest.json` supplies SHA-256 hashes.
