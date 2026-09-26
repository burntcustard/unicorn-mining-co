# Browser benchmarking

Run the repeatable browser benchmark with:

```sh
npm run benchmark
```

It starts Vite in the dedicated `benchmark` mode, opens a clean Chrome window,
and tests at a 2880 x 1800 viewport matching a high-resolution MacBook Pro.
The suite isolates the sky modes, background, lighting effects,
movement, collision detection, and all physics. It prints each result as it
completes and finishes with machine-readable JSON.

The benchmark-only query switches in `src/client/main.ts` and `src/client/lighting.ts` are
removed from normal builds by Vite. They are not available in the development
or release modes.

Environment variables:

- `BENCH_SECONDS`: measurement time per test; default `5`.
- `BENCH_WARMUP`: page warm-up time per test; default `2`.
- `BENCH_FILTER`: run only tests whose names contain this text.
- `BENCH_HEADLESS=1`: run Chrome headlessly (useful in CI). By default the
  benchmark is visible in a normal Chrome window while it runs.
- `BENCH_GAME_PORT`: local Vite port; default `4273`.
- `BENCH_DEBUG_PORT`: Chrome debugging port; default `9333`.
- `CHROME_BIN`: Chrome or Chromium executable; default `google-chrome`.

The absolute result depends heavily on whether Chrome uses hardware or software
rasterization. Comparisons between variants from the same run are the useful
part.

## Server tick profiling

```sh
node --import tsx benchmarking/server-performance.mjs
node --import tsx benchmarking/server-performance.mjs --flight
```

The first command measures empty, one-player and three-player sessions at spawn
and in the northern asteroid field. The second moves one player through ten
minutes of simulation at 300 world units per simulated second, without sending
mining inputs. It sets the position directly to keep the route repeatable; it is
not a browser flight or a real-time networking test.

Each JSON line covers 1,000 ticks and includes wall time, process CPU time,
active entities, loaded/saved regions, sleeping entities, and nested phase costs.
`geometry` is part of `collisions`, as is `solver`: do not add those columns.
Phase costs are total milliseconds across the block; `wallPerTick` and
`cpuPerTick` are milliseconds per tick. Socket stubs still serialize outgoing
packets, but exclude actual transport. Run on the same machine before and after
changes; these source-server measurements do not predict production capacity.

## Three-player flight CPU comparison

```sh
node benchmarking/three-player-flight.mjs --save=/tmp/before.mjs > /tmp/before.jsonl
# After changing the source:
node benchmarking/three-player-flight.mjs --save=/tmp/after.mjs > /tmp/after.jsonl
node benchmarking/three-player-flight.mjs --bundle=/tmp/before.mjs
node benchmarking/three-player-flight.mjs --bundle=/tmp/after.mjs
```

Run these sequentially, with browser captures and other CPU-heavy tests stopped.
The saved bundle freezes the simulation code; the same harness can replay it
later. Keep the workspace dependencies installed because `ws` is external.

Each run uses three players holding thrust with occasional steering, no mining,
and three routes: a convoy, separated players, and an asteroid contact area.
Only the initial placement is assigned directly. The next 300 ticks warm up the
session; the following 9,000 ticks represent five minutes at 30 Hz. Stub sockets
retain real snapshot serialization and hash every outgoing packet. Identical
hashes, byte counts and final positions provide a deterministic behavior check.
The run excludes browser rendering and real network transport.

`cpuMs` is process user + system CPU milliseconds per tick, including background
V8 work; `wallMs` is elapsed time per tick. `p50`, `p95` and `max` cover tick wall
time. Compare repeat runs on the same machine, not these values against a Fly
CPU capacity estimate. `--ticks=3000` shortens the measurement;
`--scenario=convoy` selects one route. `--profile` adds inclusive phase timers
that have their own overhead; use uninstrumented runs for final comparisons.
A V8 sampling profile can be collected with `node --cpu-prof`.

### Comparing broad-phase implementations

Use `--ordered-pairs` on **both** bundles when comparing different collision
indexes. It orders candidate fixture pairs consistently so collision ordering
does not change the flight path, fractures, entity density or outgoing traffic.
The production grid already uses stable fixture ordering; the flag also applies
that order to the former tree. Check all packet hashes, byte counts, positions
and entity counts before comparing CPU results. This normalization adds a small
amount of benchmark-only query work.

Keep the ordinary fresh-process results. Also use `--warm` to measure a running
server after V8 compilation and procedural caches have warmed up: it runs one
complete untimed cycle of the selected routes, creates new sessions, then
measures the same routes. Each measured session still has its usual 300-tick
warm-up and 9,000 measured ticks. Run identical options on both bundles; warmed
and ordinary packet hashes differ because process-wide generated IDs advance.

```sh
node benchmarking/three-player-flight.mjs --bundle=/tmp/before.mjs --ordered-pairs --warm
node benchmarking/three-player-flight.mjs --bundle=/tmp/after.mjs --ordered-pairs --warm
```
