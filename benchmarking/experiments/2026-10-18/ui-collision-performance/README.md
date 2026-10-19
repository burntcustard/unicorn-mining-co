# UI and collision performance evidence

See the [report](../../../../docs/experiments/2026-10-18/ui-collision-performance-2026-10-18.md)
for conclusions, methods, and limits. Local client captures were completed
earlier on October 18 and were not repeated after the live-only rerun request.

- `results/server-paired.json.gz`: 96 sequential captures, three alternating
  before/current pairs for all 16 server cases.
- `results/server-no-recovery*.json.gz`: attribution-only diagnostic captures.
- `results/profile-*.json.gz`: accompanying profiled session measurements.
- `profiles/`: before/current CPU profiles, current allocation profile, and
  saved `pprof` summaries. Allocation profiling includes setup and warmup;
  session CPU profiling covers measured ticks only.
- Other `results/` captures preserve the earlier local browser measurements.
- `results/reproduction.json`: exact revisions, compilation/runtime settings,
  executable/PGO hashes, and the live raw capture's identity.
- `patches/no-recovery.patch`: removal of one recovery call for attribution.
  This changes physics outcomes and must not be treated as a correctness fix.
- `sha256sums.txt`: checksums of retained evidence. Verify with
  `sha256sum --check sha256sums.txt` from this directory.

The diagnostic executable was built without editing the checkout: a temporary
copy of `src/server/physics/world.go` contained the patch, and a Go overlay JSON
mapped the absolute original path to that temporary file. Compilation added
`-overlay=/tmp/unicorn-regression-no-recovery-overlay.json` to the report's
normal Go test build command. Both ordinary and diagnostic executables used
`GOEXPERIMENT=simd`; the first diagnostic result's empty runtime environment
field does not record that compile-time setting. Original capture metadata is
preserved unchanged.

Live measurements are recorded separately in
[live results](../../../live/results.md#october-18-2026-at-54430-pm-gmt1).
The complete 14 MiB live raw capture remains under ignored
`benchmarking/local/live-rerun-2026-10-18T16-44-30Z.json.gz`.
