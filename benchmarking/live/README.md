# Live benchmarking

Live benchmark results live in [results.md](results.md). Each completed run appends
its dated tables to the document; live benchmarks do not belong in `docs/experiments`.

Run the reusable [live benchmark tools](../tools/README.md#live-deployment) from
the repository root:

```sh
CHROME_BIN=/path/to/chrome node benchmarking/tools/live.ts
```

The runner automatically appends results after completing all 16 cases and
stopping Chrome. Raw gzip JSON is checkpointed in ignored `benchmarking/local/`,
named with its UTC start time. An optional output path directs scratch captures
elsewhere. No raw result files or results directory are retained under `live/`.

To report a scratch capture after an interrupted run, use:

```sh
node benchmarking/tools/live-report.ts benchmarking/local/START-TIME.json.gz
```

The report generator appends one compact server/network table per run, with a
Europe/London date and time heading, and rejects duplicate captures.
An optional second argument writes a standalone scratch report instead.

## Server connection stats

The Go server logs one `connection-stats` line when a connection ends and a
`server-stats` summary every 10 minutes (read them with `fly logs`). Counters are
plain increments on existing paths; nothing is sent to clients.

- `connection-stats`: `reason` (`closed`, `idle`, `replaced`, `banned`), `seconds`,
  `players` online, snapshots (`snapshots`, `direct`, `slow` sent in the
  two-snapshot window), `snapshot_bytes`, `max_gap_ms`, stalls (`window_stalls`,
  `buffer_stalls`), `max_pending`, receipts (`receipts`, `receipt_requests`),
  lag in ticks (`mean_lag`, `max_lag`, `join_lag`, `held_lag`, the capped
  high-water mark that sets receipt spacing), `high_lag_s` (seconds from connecting
  until lag first reached 6 after the join warmup, or -1),
  `recoveries`, and inputs (`inputs`, `late`, `far`, `duplicates`, `compressed`,
  `lead_min`, `lead_max`). `max_gap_ms` is the longest gap between regular
  snapshots, starting from the first one.
- `server-stats`: cumulative finished-connection totals and `receipts_per_s`, plus
  held-lag histograms (buckets 0–8) for ended and still-open connections, split by
  age under 1 minute, 1–10 minutes, and over 10 minutes. Compare like-aged
  connections, since the high-water mark only rises with session length.
- `server-load`, printed with each `server-stats`: wall seconds, process CPU
  (`cpu_s`, `cpu_percent` of one core, `cpu_ms_per_tick`), tick duration (`ticks`,
  `tick_mean_ms`, `tick_max_ms`, `ticks_over_step`), event-loop catch-up
  (`catchups` calls covering several ticks, `catchup_ticks` extra ticks), garbage
  collection (`gc_cycles`, `gc_pause_ms`), `heap_mib`, and `players`. Each
  covers the interval since the previous line. A server stall shows as high
  `tick_max_ms` or `catchups`; a client stall leaves these unchanged.

Lag seen during a connection's first 10 seconds of snapshots (`join_lag`) still
triggers recovery and spaces that receipt, but is not remembered in `held_lag`.

## Historical harnesses

The [source ZIP](harnesses.zip) and [manifest](harnesses.manifest.json) preserve
older runner/probe sources and their SHA-256s. Their benchmark results have been
removed. Extract separately to inspect the sources without replacing the active
tools:

```sh
python3 -m zipfile -l benchmarking/live/harnesses.zip
python3 -m zipfile -e benchmarking/live/harnesses.zip /tmp/unicorn-live-harnesses
```
