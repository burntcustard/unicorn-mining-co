# Benchmarking

Run commands from the repository root. Keep reusable runners, saved evidence,
and disposable local output separate:

| Location                                            | Contents                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| [tools/](tools/README.md)                           | Benchmark runners, workloads, and detailed usage                                 |
| [experiments/](experiments/README.md)               | Retained captures, patches, and profiles, grouped by date and topic              |
| [archive/](archive/README.md)                       | Compressed older reports and results, with checksums and extraction instructions |
| `local/`                                            | Ignored scratch output from new runs                                             |
| [Experiment reports](../docs/experiments/README.md) | Findings, decisions, limitations, and reproduction commands                      |

## Common checks

| Check                     | Command                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| Browser rendering         | `npm run benchmark` or `npm run benchmark:headless`                          |
| Shared simulation         | `npm run benchmark:simulation`                                               |
| Go / Node sessions        | `npm run benchmark:go`                                                       |
| Production flight CPU     | `node benchmarking/tools/production-flight.mjs --warm`                       |
| Two-client input response | `node benchmarking/tools/input-response-browser.mjs /tmp/response.json.gz 5` |
| Four-client presentation  | `node benchmarking/tools/remote-browser.mjs /tmp/remote.json.gz`             |
| Brief network outage      | `node benchmarking/tools/stall-browser.mjs /tmp/stall.json.gz 5 network`     |

The client response, presentation, and outage checks require a fresh game server
on 3001 and Vite on 3000, using the normal proxy. Follow the repository's
[local testing workflow](../.agents/skills/codebase-workflow/SKILL.md), and stop
the processes when finished. The response/outage delay argument is milliseconds
**each way**, so `5` models a 10 ms round trip. CPU comparisons should run
sequentially without builds or browser captures competing for resources.

The Go comparison runners default to `local/`; `RESULT=/path/to/file.json`
overrides that destination and creates its parent directory. Other runners use
their documented output argument or stdout. See the [tool reference](tools/README.md)
for options and the [artifact conventions](experiments/README.md) before saving
results in the repository. Old result metadata and embedded source snapshots
retain their original paths; current report links point to their new locations.
