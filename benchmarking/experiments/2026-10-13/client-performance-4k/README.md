# Native 4K gameplay performance

See the [report](../../../../docs/experiments/2026-10-13/client-performance-4k-2026-10-13.md)
for acceptance criteria, renderer comparisons, simplification review, regression
checks, and resource sizes.

With the normal Go/Vite pair running and the build finished, run sequentially:

```sh
GAMEPLAY_RESOLUTION=3840x2160 GAMEPLAY_SCREENSHOTS=1 \
  node benchmarking/tools/gameplay-performance.ts chrome 60
GAMEPLAY_RESOLUTION=3840x2160 GAMEPLAY_SCREENSHOTS=1 \
  node benchmarking/tools/gameplay-performance.ts firefox 60
```

Do not run tests, builds, profiles, or other browser checks during capture.
The owned browser runs fullscreen on the primary 120 Hz display. Native viewport
and backing-store dimensions, default zoom, audio, ammunition consumption,
fractures, camera movement, and browser errors are checked by the runner.

`results/` contains immutable copies of the local captures. Final acceptance
captures are `chrome-final.json` and `firefox-final.json`; `*-before-review.json`
are the successful 4K runs before simplification. Renderer comparisons are
explicitly named `*-rejected.json` and are excluded from acceptance. Station
captures use a diagnostic field that keeps its panels visible, rather than the
original isolated field. They are not interchangeable with the main workloads.

CPU tuples contain mean, p95, p99, and maximum milliseconds. FPS window arrays
contain the minimum first, followed by the consecutive completed roughly
one-second windows. Temporary profile paths and original metadata are preserved.
