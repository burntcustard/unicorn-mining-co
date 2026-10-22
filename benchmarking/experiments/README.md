# Saved experiments

Each investigation uses `YYYY-MM-DD/topic/`. Its report lives under the matching
date in [docs/experiments](../../docs/experiments/README.md). Within a topic:

- `results/` holds raw measurements, summaries, disassembly, and captured traces.
- `patches/` holds experimental source changes and their assembly notes.
- `profiles/` holds CPU and heap profiles. Fixed PGO inputs are deduplicated by
  SHA-256 under [`benchmarking/profiles`](../profiles/README.md).
- An optional `README.md` or small reproduction script provides topic-specific context.

Live benchmark results live separately in
[benchmarking/live/results.md](../live/results.md). Raw captures are ignored
scratch output under `benchmarking/local/`.

## Retained investigations

The [October 22 transport investigation](../../docs/experiments/2026-10-22/go-server-cpu-transport.md)
records a further 24.23% CPU saving in the complete two-core TCP matrix, bounded
cumulative receipts, nonblocking sends, jitter/backpressure tests, and source snapshots.

The [October 22 compiler investigation](../../docs/experiments/2026-10-22/go-server-cpu-lowering.md)
retains instruction disassembly, inherited hardware counters, compiler/architecture
screens, rejected physics/transport prototypes, and further paired CPU measurements.

The [October 22 Go CPU investigation](../../docs/experiments/2026-10-22/go-server-cpu.md)
retains recovery pruning, matched two-core session/combat/TCP comparisons,
PGO inputs, exact recovery checks, source overlays, and rejected allocation work.

The [NPC pursuit investigation](../../docs/experiments/2026-10-20/npc-pursuit.md)
compares short target forecasts and selective asteroid outlines on fixed moving
courses, including narrow gaps, blind validation, and paired combat CPU runs.

The [NPC clearance experiment](../../docs/experiments/2026-10-20/npc-clearance.md)
compares complete removal of the extra navigation margin with the accepted
one-unit setting, preserving pursuit and combat CPU results.

The [NPC maneuver investigation](../../docs/experiments/2026-10-20/npc-maneuvers.md)
compares circle-based navigation, corner control, clearance margins, arrival,
and generated-field pursuit, with paired combat CPU measurements.

The [pirate combat CPU investigation](../../docs/experiments/2026-10-20/pirate-cpu.md)
retains paired one-player/one-pirate combat benchmarks, generated pursuit-course
replays, source overlays and profiles, including full-throttle chases.

The [native-resolution follow-up](../../docs/experiments/2026-10-19/native-resolution-performance.md)
separates 1920 × 1200 rendering work from laptop power policy, retains the small
text-cache improvement, and records rejected candidates and sustained captures.

The [canvas and radar follow-up](../../docs/experiments/2026-10-18/canvas-followup-2026-10-18.md)
retains corrected paired browser measurements, the one-line shared minimap
improvement, and rejected foreground/reset experiments.

The [input and startup follow-up](../../docs/experiments/2026-10-18/input-startup-2026-10-18.md)
retains corrected Chrome/Firefox timing captures and the fixes for cold input
and already-reached snapshots.

The [October 18 UI and collision comparison](2026-10-18/ui-collision-performance/)
retains the server regression profiles and earlier local client captures. The
[report](../../docs/experiments/2026-10-18/ui-collision-performance-2026-10-18.md)
links to the completed live rerun, which is recorded separately.

The [performance follow-up](../../docs/experiments/2026-10-18/performance-fixes-2026-10-18.md)
records the subsequent recovery and HUD improvements.

The [native 4K follow-up](2026-10-13/client-performance-4k/) includes renderer
comparisons and the final simplification/regression checks.

| Date       | Topic                                                         | Report                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | [Client gameplay performance](2026-10-13/client-performance/) | [Native-resolution Chrome and Firefox results](../../docs/experiments/2026-10-13/client-performance-2026-10-13.md)                                                                                                                                                                              |
| 2026-10-02 | [WebSocket transport](2026-10-02/websocket-transport/)        | [Multicore networking](../../docs/experiments/2026-10-02/go-network-multicore-2026-10-02.md), [framing investigation](../../docs/experiments/2026-10-02/websocket-transport-2026-10-02.md), [superseded runtime experiment](../../docs/experiments/2026-10-02/go-network-runtime-2026-10-02.md) |
| 2026-10-02 | [Remote motion and recovery](2026-10-02/remote-motion/)       | [Client movement reports](../../docs/experiments/README.md#2026-10-02)                                                                                                                                                                                                                          |
| 2026-10-01 | [Go CPU](../archive/README.md#2026-10-01)                     | [CPU follow-up](../../docs/experiments/2026-10-01/go-server-cpu-comparison-2026-10-01-followup.md)                                                                                                                                                                                              |
| 2026-10-01 | [Solver](../archive/README.md#2026-10-01)                     | [Solver redesign](../../docs/experiments/2026-10-01/go-server-solver-redesign-2026-10-01.md)                                                                                                                                                                                                    |
| 2026-10-01 | [Packed physics](2026-10-01/packed-physics/)                  | [Packed physics investigation](../../docs/experiments/2026-10-01/go-server-packed-physics-2026-10-01.md)                                                                                                                                                                                        |
| 2026-10-01 | [Precision and SIMD](2026-10-01/precision-simd/)              | [Precision investigation](../../docs/experiments/2026-10-01/go-server-precision-simd-2026-10-01.md)                                                                                                                                                                                             |
| 2026-10-01 | [Snapshot cadence](2026-10-01/snapshot-cadence/)              | [30 Hz snapshots](../../docs/experiments/2026-10-01/snapshot-cadence-2026-10-01.md)                                                                                                                                                                                                             |

## Keeping this organized

Write provisional output to `benchmarking/local/` or `/tmp`. When retaining a
result, place it under its actual measurement date and topic, then link it from
the report. Keep descriptive filenames; existing dated names are retained to
preserve capture identity. Saved evidence is immutable: do not rewrite embedded
source, historical commands, hashes, or result metadata merely to update paths.
Use the current reports and tool reference for current commands.

On October 22, completed investigations dated October 1–21 were bundled into
[date archives](../archive/README.md#completed-october-experiments), including
source snapshots, images, patches, and original reports. Topic READMEs and current
reports point to the extraction instructions. October 22 tools remain directly
accessible. Restore archives with `node benchmarking/tools/extract-experiments.ts all`;
the default output is ignored `benchmarking/local/restored/`.

Use `.json.gz` for large loose captures; ZIP compression handles plain JSON in
archives. Name command-output captures `.log` and heap profiles `.heap.pprof`.
Captured source keeps its `.go.txt` or `.ts.txt` suffix so it cannot accidentally
become part of current builds or linting. Every archive contains its experiment
tree and required inputs at their repository-relative paths, ready to unzip.

On 2 October 2026, material dated before 1 October was moved into the
[September archive](../archive/README.md#september-2026). This is a one-time
cutoff, not an automatic rolling deletion policy. Reusable tools remain active
regardless of age. Archive older reports and results together, preserving their
paths and including the inputs needed by their scripts.
Keep a browsable report catalog and point surviving links to it.
