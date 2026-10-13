# Client gameplay performance

See the [investigation report](../../../../docs/experiments/2026-10-13/client-performance-2026-10-13.md)
for accepted results, implementation, rejected experiments, validation, and
resource sizes. Captures use this device's primary 120 Hz display, a native
2560 × 1440 viewport/backing canvas, and default zoom 1.5.

With the normal Go/Vite services already running and the build finished:

```sh
GAMEPLAY_SCREENSHOTS=1 node benchmarking/tools/gameplay-performance.ts chrome 60
GAMEPLAY_SCREENSHOTS=1 node benchmarking/tools/gameplay-performance.ts firefox 60
```

Run browsers sequentially, with builds, tests, and profilers stopped. Each run
covers live flight, large fractures, dense combat, continuous flight, and a
minimal canvas reference. Results include activity assertions and errors;
CPU tuples are mean, p95, p99, and maximum milliseconds. The runner uses
production transforms and separately emitted lazy modules.

Retained files in `results/` are copied from ignored `benchmarking/local/`:

- `chrome-before.json` / `firefox-before.json`: the corrected original-client
  combat captures, 30 seconds, originally named `*-corrected-baseline.json`.
- `chrome-final.json`: final retained client, 60 seconds per workload,
  originally `chrome-final-native.json`.
- `firefox-final.json`: final retained client, 60 seconds per workload,
  originally `firefox-checkpoint-cache-native.json`.
- `*-combat.png` and `*-large.png`: native-resolution gameplay screenshots
  captured immediately after their corresponding workload.
- `resource-sizes.json`: original/final production resources, raw and gzip 1.
- `firefox-*-allocation-summary.json`: diagnostic sampled allocation summaries
  before/after clone callback removal; profiling affects timing and these are
  excluded from acceptance. Raw profiles remain in ignored local scratch.

Metadata, including temporary profile paths and original source identifiers,
is preserved. The report identifies later formatting-only changes and the
Chrome WebGL-unavailable fallback; Firefox's measured renderer is unchanged.
