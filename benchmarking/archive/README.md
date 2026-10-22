# Experiment archive

Older experiment reports and results are stored together with their original
repository paths. Reusable benchmark tools remain in [tools](../tools/README.md).
Current reports are indexed in [docs/experiments](../../docs/experiments/README.md).

## Completed October experiments

Investigations before October 22, 2026 are bundled by date. Current reports remain
browsable under `docs/experiments`; each archive includes the original reports,
source snapshots, raw results, logs, images, patches, and manifests at their
repository paths. October 22 reproduction tools remain loose.

```sh
node benchmarking/tools/extract-experiments.ts all
node benchmarking/tools/extract-experiments.ts 2026-10-20 /tmp/unicorn-evidence
```

The default destination is ignored `benchmarking/local/restored/`. Every ZIP
contains repository-relative paths, including the PGO inputs its scripts use.
Extraction simply unpacks the ZIP; any ordinary ZIP tool works too. ZIP handles
compression for archived plain JSON files. All dates can be extracted together
when an experiment uses earlier evidence. Reproduction still needs the recorded
source checkout and toolchain.

For new experiments, save `YYYY-MM-DD.zip` here with paths relative to the
repository root. Include the experiment directory, its report, and any captured
inputs its scripts need, including shared PGO inputs. The extractor discovers
new ZIPs automatically; no registration or script changes are needed.

### 2026-10-01

[ZIP](2026-10-01.zip) · [Inventory and SHA-256 checksums](2026-10-01.manifest.json)

367 archived files; 26,331,622 compressed bytes.

### 2026-10-02

[ZIP](2026-10-02.zip) · [Inventory and SHA-256 checksums](2026-10-02.manifest.json)

86 archived files; 2,573,395 compressed bytes.

### 2026-10-13

[ZIP](2026-10-13.zip) · [Inventory and SHA-256 checksums](2026-10-13.manifest.json)

36 archived files; 17,260,918 compressed bytes.

### 2026-10-14

[ZIP](2026-10-14.zip) · [Inventory and SHA-256 checksums](2026-10-14.manifest.json)

32 archived files; 13,736,123 compressed bytes.

### 2026-10-18

[ZIP](2026-10-18.zip) · [Inventory and SHA-256 checksums](2026-10-18.manifest.json)

351 archived files; 8,222,717 compressed bytes.

### 2026-10-19

[ZIP](2026-10-19.zip) · [Inventory and SHA-256 checksums](2026-10-19.manifest.json)

418 archived files; 13,807,647 compressed bytes.

### 2026-10-20

[ZIP](2026-10-20.zip) · [Inventory and SHA-256 checksums](2026-10-20.manifest.json)

275 archived files; 5,801,922 compressed bytes.

### 2026-10-21

[ZIP](2026-10-21.zip) · [Inventory and SHA-256 checksums](2026-10-21.manifest.json)

245 archived files; 508,711 compressed bytes.

## September 2026

[Download the ZIP](2026-09.zip) · [File inventory and SHA-256 checksums](2026-09.manifest.json)

The 2 October cleanup archived all dated reports/results before 1 October,
including the undated September 24–25 physics consolidation log and the two
September Go/Node result files formerly in the benchmarking root. Capture dates
and report contents determine age, not the date a later commit touched a file.

The archive contains **70 files**, 7,711,631 bytes before compression and 829,286 bytes compressed. Every entry was read back and verified before the loose originals were removed. The manifest records source revision `8b48c7917fb81d79af72f2807c5024ff3e22cbf8` and the archive checksum.

The September 27 physics report now includes the WAT bounds-kernel source and
regeneration instructions, folded into the experiment on October 22, 2026.
Its original report checksum and size remain in the manifest alongside the
updated values.

### Browse or extract

Run from the repository root:

```sh
python3 -m zipfile -l benchmarking/archive/2026-09.zip
python3 -m zipfile -t benchmarking/archive/2026-09.zip
archive_dir=$(mktemp -d /tmp/unicorn-experiments-XXXXXX)
python3 -m zipfile -e benchmarking/archive/2026-09.zip "$archive_dir"
```

Extract into a separate directory to preserve the active layout. Apart from the
WAT source addition noted above, files retain their original bytes and paths;
historical links to other archived files work within that extracted tree.
Links to source or newer files need the recorded repository
revision. This is an evidence archive, not a standalone runnable checkout.

To read the retained WAT source, open
`docs/experiments/performance-investigation-2026-09-27.md` in the extracted tree,
under “Retained WebAssembly bounds kernel source.”

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
