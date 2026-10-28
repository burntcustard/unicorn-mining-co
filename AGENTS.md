# Benchmarking

Start each extensive local server benchmarking session with a fresh world. Stop
the local Go watcher, run `npm run reset-world:local`, and restart the normal
watcher. Reset once before the full matrix.

Preserve live world data during benchmarking. Reset the live world only when
the user explicitly requests it.

Test CPU optimizations locally before deploying them. After a live server
restart or update, wait at least 10 minutes before running live benchmarks so
CPU burst credit can accumulate. Record Fly CPU balance and throttle counters
across the complete suite, including preparation; a peak case above the
sustained CPU quota does not by itself mean the suite throttled. Keep the
benchmark suite and gameplay timing unchanged when evaluating CPU savings.

Match the live Go memory budget in local CPU comparisons and verify the recorded
runtime environment. The benchmark's `--cores` flag changes affinity, not memory.
