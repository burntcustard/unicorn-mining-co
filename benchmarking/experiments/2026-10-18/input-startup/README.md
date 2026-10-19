# Input and startup investigation evidence

See the [report](../../../../docs/experiments/2026-10-18/input-startup-2026-10-18.md)
for the shared fixes, browser results, and limitations. No changes were deployed.

- `results/verified-*`: seven final captures and their logs. Three visible-window
  captures per browser and one default headless Chrome capture all pass the
  original latency, visibility, browser-error, and audio assertions.
- Other `results/*.json.gz`: 35 diagnostic/intermediate captures, including
  failures. Page-timer, worker, native, proxy, and audio-disabled experiments
  use different methods or code. Their original summaries remain unchanged.
  In particular, `final-firefox-5-3` predates the reached-tick snapshot fix and
  reproduces its extra frame of waiting.
- `results/summary.json`: derived capture table and production resource sizes.
- `results/reproduction.json`: final source hashes, browser versions, conditions,
  and executable hash. The final sources are exact snapshots; earlier diagnostic
  harness iterations are described rather than claimed to share those hashes.
- `results/temporary-server-trace.log` and
  `patches/temporary-server-trace.patch`: read/apply timing for the two worker
  diagnostics. The trace patch was removed from the working tree before final
  validation.
- `results/{before-build,build,tests,lint,ui}.log`: completed verification.
- `sources/`: source snapshots as `.ts.txt`, including the browser driver,
  metrics, development proxy hook, product changes, and regression tests.
- `patches/product.patch`: all current product changes relative to `94969b9`,
  including the preceding recovery and HUD improvements.

From this directory, verify retained bytes with:

```sh
sha256sum --check sha256sums.txt
```

Use current runner commands in the report. The discarded worker and temporary
audio-disabled diagnostics are not modes of the final runner. The earlier
nine-capture input comparison remains in the separate
[recovery/HUD evidence](../performance-fixes/README.md).
