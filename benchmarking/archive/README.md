# Experiment archive

Older experiment reports and results are stored together with their original
repository paths. Reusable benchmark tools remain in [tools](../tools/README.md).
Current reports are indexed in [docs/experiments](../../docs/experiments/README.md).

## September 2026

[Download the ZIP](2026-09.zip) · [File inventory and SHA-256 checksums](2026-09.manifest.json)

The 2 October cleanup archived all dated reports/results before 1 October,
including the undated September 24–25 physics consolidation log and the two
September Go/Node result files formerly in the benchmarking root. Capture dates
and report contents determine age, not the date a later commit touched a file.

The archive contains **70 files**, 7,708,891 bytes before compression and 828,329 bytes compressed. Every entry was read back and verified before the loose originals were removed. The manifest records source revision `8b48c7917fb81d79af72f2807c5024ff3e22cbf8` and the archive checksum.

### Browse or extract

Run from the repository root:

```sh
python3 -m zipfile -l benchmarking/archive/2026-09.zip
python3 -m zipfile -t benchmarking/archive/2026-09.zip
archive_dir=$(mktemp -d /tmp/unicorn-experiments-XXXXXX)
python3 -m zipfile -e benchmarking/archive/2026-09.zip "$archive_dir"
```

Extract into a separate directory to preserve the active layout. Files retain
original bytes and paths; historical links to other archived files work within
that extracted tree. Links to source or newer files need the recorded repository
revision. This is an evidence archive, not a standalone runnable checkout.

### Reports inside the ZIP

- **Go / Node session benchmark — 2026-09-30** — `docs/experiments/go-server-benchmark-2026-09-30.md`
- **Client input latency** — `docs/experiments/input-latency-2026-09-29.md`
- **Live multiplayer freeze investigation — 27 September 2026** — `docs/experiments/live-freeze-investigation-2026-09-27.md`
- **Multiplayer freeze fixes — 27 September 2026** — `docs/experiments/multiplayer-freeze-fixes-2026-09-27.md`
- **Networking follow-ups for the public alpha** — `docs/experiments/networking-alpha-2026-09-27.md`
- **One-tick remote motion buffer** — `docs/experiments/networking-buffer-2026-09-27.md`
- **Networking lessons from nengi RC.127** — `docs/experiments/networking-nengi-2026-09-27.md`
- **Collision cache follow-up — 27 September 2026** — `docs/experiments/performance-collision-caches-2026-09-27.md`
- **One-input collision step — 2026-09-28** — `docs/experiments/performance-collision-one-input-2026-09-28.md`
- **Server CPU follow-up: five proposed changes** — `docs/experiments/performance-cpu-followup-2026-09-28.md`
- **CPU follow-up: binary-only networking and snapshot cadence** — `docs/experiments/performance-cpu-followup-2026-09-29.md`
- **CPU Performance Investigation: Method and Successful Changes** — `docs/experiments/performance-cpu-methodology-2026-09-29.md`
- **Server CPU at 4, 8 and 16 players — 2026-09-28** — `docs/experiments/performance-cpu-players-2026-09-28.md`
- **Description pre-generation and collision experiments — 27 September 2026** — `docs/experiments/performance-dormant-world-2026-09-27.md`
- **Elapsed-time server updates — 2026-09-27** — `docs/experiments/performance-elapsed-time-2026-09-27.md`
- **Three-player CPU investigation — 26 September 2026** — `docs/experiments/performance-investigation-2026-09-26-three-player.md`
- **Server slowdown investigation — 26 September 2026** — `docs/experiments/performance-investigation-2026-09-26.md`
- **Collision and physics investigation, 27 September 2026** — `docs/experiments/performance-investigation-2026-09-27.md`
- **Monomorphism follow-up — 2026-09-27** — `docs/experiments/performance-monomorphism-2026-09-27.md`
- **Integer and fixed-point investigation — 27 September 2026** — `docs/experiments/performance-numeric-representations-2026-09-27.md`
- **Persistent replication and movement storage, 27 September 2026** — `docs/experiments/performance-persistent-state-2026-09-27.md`
- **Pre-generating a 50,000-unit world area — 27 September 2026** — `docs/experiments/performance-region-prewarm-2026-09-27.md`
- **Server CPU follow-up — 2026-09-27** — `docs/experiments/performance-server-cpu-2026-09-27.md`
- **Server CPU categories, 27 September 2026** — `docs/experiments/performance-server-phases-2026-09-27.md`
- **Server Set iteration experiments — 2026-09-27** — `docs/experiments/performance-set-iteration-2026-09-27.md`
- **Performance and simplification follow-up — 26–27 September 2026** — `docs/experiments/performance-simplification-2026-09-26.md`
- **Collision and physics consolidation** — `docs/experiments/physics-consolidation.md`
