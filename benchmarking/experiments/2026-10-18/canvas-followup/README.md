# Canvas and radar performance evidence

See the [report](../../../../docs/experiments/2026-10-18/canvas-followup-2026-10-18.md).

- results/captures contains unmodified raw JSON captures compressed with gzip.
- results/radar-summary.json is the corrected three-pair comparison; combat-summary.json is the one-pair 4K check.
- results/reproduction.json classifies every completed capture and records exclusions, source context, profile hashes, and capture-guard checks.
- results/logs includes the two explicitly aborted exploratory runs and intentional guard failures.
- profiles contains weighted native Firefox summaries; large raw profiles remain in ignored local output at their recorded paths.
- patches/retained-minimap.patch is the complete one-line shipping rendering change for this follow-up. Other candidate patches are rejected diagnostics.
- patches/source-snapshots and patches/drivers preserve the tested implementation and temporary diagnostic drivers. Source snapshots use .txt to keep historical copies out of compilation/lint.
- Full product patches also include the prior recovery/input/HUD fixes relative to 94969b9. Apply the before state plus the corrected workload and canvas-diagnostic-radar driver to reproduce primary comparisons; the final canonical runner verifies the shipping source without overrides.

Run drivers from the repository root with the standard Go/Vite pair, /snap/bin/chromium and /usr/bin/firefox, and a workspace TMPDIR visible to Snap. GAMEPLAY_SOFTWARE_MINIMAP=1 in the saved diagnostic requests the candidate; absence uses the before-source default. The radar reproduction queue records alternating order and 30-second durations. Update absolute imports only in a disposable replay copy if your checkout is elsewhere.

Verify retained files:

```sh
sha256sum --check sha256sums.txt
```
