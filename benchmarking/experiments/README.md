# Saved experiments

Each investigation uses `YYYY-MM-DD/topic/`. Its report lives under the matching
date in [docs/experiments](../../docs/experiments/README.md). Within a topic:

- `results/` holds raw measurements, summaries, disassembly, and captured traces.
- `patches/` holds experimental source changes and their assembly notes.
- `profiles/` holds CPU profiles and saved PGO inputs.
- An optional `README.md` or small reproduction script provides topic-specific context.

Live benchmark results live separately in
[benchmarking/live/results.md](../live/results.md). Raw captures are ignored
scratch output under `benchmarking/local/`.

## Retained investigations

| Date       | Topic                                                   | Report                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | [WebSocket transport](2026-10-02/websocket-transport/)  | [Multicore networking](../../docs/experiments/2026-10-02/go-network-multicore-2026-10-02.md), [framing investigation](../../docs/experiments/2026-10-02/websocket-transport-2026-10-02.md), [superseded runtime experiment](../../docs/experiments/2026-10-02/go-network-runtime-2026-10-02.md) |
| 2026-10-02 | [Remote motion and recovery](2026-10-02/remote-motion/) | [Client movement reports](../../docs/experiments/README.md#2026-10-02)                                                                                                                                                                                                                          |
| 2026-10-01 | [Go CPU](2026-10-01/go-cpu/README.md)                   | [CPU follow-up](../../docs/experiments/2026-10-01/go-server-cpu-comparison-2026-10-01-followup.md)                                                                                                                                                                                              |
| 2026-10-01 | [Solver](2026-10-01/solver/README.md)                   | [Solver redesign](../../docs/experiments/2026-10-01/go-server-solver-redesign-2026-10-01.md)                                                                                                                                                                                                    |
| 2026-10-01 | [Packed physics](2026-10-01/packed-physics/)            | [Packed physics investigation](../../docs/experiments/2026-10-01/go-server-packed-physics-2026-10-01.md)                                                                                                                                                                                        |
| 2026-10-01 | [Precision and SIMD](2026-10-01/precision-simd/)        | [Precision investigation](../../docs/experiments/2026-10-01/go-server-precision-simd-2026-10-01.md)                                                                                                                                                                                             |
| 2026-10-01 | [Snapshot cadence](2026-10-01/snapshot-cadence/)        | [30 Hz snapshots](../../docs/experiments/2026-10-01/snapshot-cadence-2026-10-01.md)                                                                                                                                                                                                             |

## Keeping this organized

Write provisional output to `benchmarking/local/` or `/tmp`. When retaining a
result, place it under its actual measurement date and topic, then link it from
the report. Keep descriptive filenames; existing dated names are retained to
preserve capture identity. Saved evidence is immutable: do not rewrite embedded
source, historical commands, hashes, or result metadata merely to update paths.
Use the current reports and tool reference for current commands.

On 2 October 2026, material dated before 1 October was moved into the
[September archive](../archive/README.md#september-2026). This is a one-time
cutoff, not an automatic rolling deletion policy. Reusable tools remain active
regardless of age. Archive older reports and results together, preserving their
paths, and verify extracted bytes against a manifest before removing originals.
Keep a browsable report catalogue and point surviving links to it.
