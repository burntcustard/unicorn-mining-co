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
