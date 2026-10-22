# Input acknowledgment investigation

The [report](../../../../docs/experiments/2026-10-22/input-acknowledgment.md)
records the live evidence, insufficient candidates, retained recovery change,
and local validation. All 17 browser captures completed with matching host,
browser, runner, viewport, durations, and production script hashes.

- `results/` retains browser captures, acknowledgment analyses, alternating TCP
  measurements, final test logs, keyboard response, and the expected regression
  failure on the deployed algorithm.
- `sources/` retains the compared session implementations, final tests, probes,
  analysis script, and temporary repeat driver. Captured source has `.txt`
  suffixes and does not enter the build.
- `manifest.json` records artifact sizes and SHA-256s. `results/summary.json`
  records per-run statistics, settings, client assets, binary sizes, and PGO hash.

Variant names in capture filenames are `before` (pre-CPU source overlay),
`current` (deployed receipt algorithm), `fixed` (insufficient cap-only candidate),
`recovery` (insufficient timer-only candidate), and `active` (retained fix).
The raw runner's Git revision identifies the checkout; the session source
snapshots and this mapping identify the server algorithm actually exercised.
The pre-CPU overlay uses revision `5cfd246`; current builds use the same current
PGO profile. The repeat driver expects its original temporary overlay paths;
use the report's focused command for a new capture of the retained implementation.

To regenerate acknowledgment analysis from any retained capture:

```sh
node benchmarking/tools/live-ack-analysis.ts benchmarking/experiments/2026-10-22/input-acknowledgment/results/ack-browser-active-1.json.gz benchmarking/local/ack-analysis.json.gz
```

Live captures themselves remain in ignored scratch storage as documented in the
report. Their derived evidence is retained here as `live-ack-evidence.json.gz`.
