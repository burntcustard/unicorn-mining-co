# Browser benchmarking

Run the repeatable browser benchmark with:

```sh
npm run benchmark
```

It starts Vite in the dedicated `benchmark` mode, launches a clean headless
Chrome profile, and tests at a 2880 x 1800 viewport matching a high-resolution
MacBook Pro. The suite isolates the sky modes, background, lighting effects,
movement, collision detection, and all physics. It prints each result as it
completes and finishes with machine-readable JSON.

The benchmark-only query switches in `src/main.js` and `src/lighting.js` are
removed from normal builds by Vite. They are not available in the development
or release modes.

Environment variables:

- `BENCH_SECONDS`: measurement time per test; default `5`.
- `BENCH_WARMUP`: page warm-up time per test; default `2`.
- `BENCH_FILTER`: run only tests whose names contain this text.
- `BENCH_GAME_PORT`: local Vite port; default `4273`.
- `BENCH_DEBUG_PORT`: Chrome debugging port; default `9333`.
- `CHROME_BIN`: Chrome or Chromium executable; default `google-chrome`.

The absolute result depends heavily on whether Chrome uses hardware or software
rasterization. Comparisons between variants from the same run are the useful
part.
