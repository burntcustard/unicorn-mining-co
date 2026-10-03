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

## Historical harnesses

The [source ZIP](harnesses.zip) and [manifest](harnesses.manifest.json) preserve
older runner/probe sources and their SHA-256s. Their benchmark results have been
removed. Extract separately to inspect the sources without replacing the active
tools:

```sh
python3 -m zipfile -l benchmarking/live/harnesses.zip
python3 -m zipfile -e benchmarking/live/harnesses.zip /tmp/unicorn-live-harnesses
```
