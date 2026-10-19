# Recovery and HUD performance evidence

See the [report](../../../../docs/experiments/2026-10-18/performance-fixes-2026-10-18.md)
for the changes, methods, results, and remaining limits. The fixes are local and
have not been deployed.

- `results/server-paired.json.gz`: all 16 server cases in three alternating
  unchanged/optimized pairs, with strict outcome checks, 1,800 measured ticks.
- `results/server-long-paired.json.gz`: the longer 32-player module comparison.
- `profiles/recovery-profile*`: the separate 6,000-tick diagnostic CPU profile
  and text summary. Its accompanying session metrics are in `results/`.
- `results/*final*.json.gz`: ordinary browser acceptance captures and all
  initial two-client input captures, including the failures.
- `results/input-control-*.json.gz` and `results/input-optimized-isolated-*.json.gz`:
  unchanged and optimized client controls using the same isolated frontend and
  the same running authoritative server. No input threshold was relaxed.
- Other Firefox captures cover the early-read and no-blur diagnostics and the
  final cached-size variant. They are separate from acceptance captures.
- `results/firefox-*-profile-summary.json.gz`: weighted local-tab CPU summaries.
  Raw native Firefox profiles remain in ignored `benchmarking/local/`; hashes
  and exact paths are in `results/reproduction.json`.
- `profiles/firefox-summary.ts.txt`: the analysis script as a source snapshot.
  Copy it to a `.ts` file and run with `node SCRIPT INPUT_PROFILE OUTPUT_JSON`.
  It sums `threadCPUDelta` nanoseconds over inclusive stack labels in the local
  tab. Marker duration sums include complete interval records only.
- `results/summary.json`: derived CPU, browser, input phase, and resource tables.
- `results/reproduction.json`: source/compiler/executable hashes and conditions.
- `patches/`: the tested recovery-only patch and final product patch, both based
  on `94969b9`. The former predates two whitespace-only lint corrections.
- `results/tests.log`, `ui-tests.log`, and `lint.log`: completed verification.

The initial Chromium 4K capture that overlapped test startup is excluded and
remains in ignored scratch output with `-overlapped-tests` in its filename.
The clean repeat is retained. The three failed input startup checks are retained
and called out in the report; they have not been excluded from the summary.

Verify evidence from this directory with:

```sh
sha256sum --check sha256sums.txt
```

For server reproduction, compile unchanged `94969b9` and the patched source in
separate directories, using `CGO_ENABLED=0 GOEXPERIMENT=simd go test -c
-pgo=./src/server/default.pgo ./src/server/network`. Run
`benchmarking/tools/go-cpu-paired.ts` with `BEFORE_GOGC=200 AFTER_GOGC=200`,
`GOMAXPROCS=2 GOMEMLIMIT=off CPU_AFFINITY=0,1 OUTCOME_COMPARISON=strict`,
`TICKS=1800 REPETITIONS=3`. The longer comparison selects `PLAYERS=32
WORKLOADS=module TICKS=6000 REPETITIONS=1`. Finish builds and stop temporary
browser/server load before CPU measurements.
