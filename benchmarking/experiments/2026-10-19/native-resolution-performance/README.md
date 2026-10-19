# Native-resolution performance evidence

See the [report](../../../../docs/experiments/2026-10-19/native-resolution-performance.md)
for conclusions and the selected plugged-in Performance profile. These measurements
separate physical 1920 × 1200 rendering from oversized virtual viewports and
from the laptop's Balanced/Performance power policies.

- `results/summary.json` indexes the 50 selected completed captures. Raw JSON,
  request flags, power sidecars, host information, resource sizes, and validation
  logs retain their original capture identities.
- `patches/` contains the retained change, the working-tree source patch,
  previous/current text, exact transformed experimental sources, and compressed
  compiled fixtures. `.ts.txt` and `.js.txt.gz` are immutable snapshots, not
  active build inputs.
- `profiles/` contains the weighted CPU analyses, exact profiled code, and a
  CPU-only Firefox trace. `derivation.json` records its source hash and omitted
  screenshot payload. All CPU analysis was checked against the complete trace.
  The complete original and its byte-identical gzip archive remain in ignored
  local storage at the paths recorded there.
- `excluded/` preserves invalid/mislabeled first-queue probes, interrupted runs,
  and failed validity checks. Do not use them as evidence for their named changes.
- `tools/` preserves the actual local diagnostic generators, queues, and parsers.
  Embedded historical paths and commands are unchanged.

`text-current-*-performance-*` uses a temporary Performance power-profile hold.
`text-pcores-*` pins only the owned browser tree to the fast cores and is a
scheduling diagnostic. Neither establishes the target on Balanced power.
`power-smoke-*` checks the final runner's per-scenario power metadata; its short
captures are not performance estimates. Other requested flags and actual HUD
blur are recorded in their capture/request files.

Verify saved bytes from this directory:

```sh
sha256sum -c sha256sums.txt
```

For a current shipping-source run, reuse the standard development services,
finish the production build first, and set the installed browser paths and a
Snap-visible temporary directory as needed:

```sh
GAMEPLAY_NATIVE=1 GAMEPLAY_RESOLUTION=1920x1200 \
  node benchmarking/tools/gameplay-performance.ts firefox 30 OUTPUT.json
```

Run one browser at a time with no builds, tests, or profiling in parallel.
The runner now records power policy per scenario and rejects a policy change.
A temporary profile comparison can wrap the same command in
`powerprofilesctl launch --profile performance`; the profile hold releases when
the command exits. Do not mix its results with Balanced captures.

To replay the paired text experiment, copy the saved generator and queue from
`tools/*.ts.txt` to `.ts` scratch files. Restore `patches/text-before.ts.txt` as
`benchmarking/local/native-performance-2026-10-18/v2-shared-firefox-checked-1.source-text.ts`,
run the generator from the repository root, then use queue arguments such as
`firefox:old:REPEAT:large,combat,flight:30` and
`firefox:current:REPEAT:large,combat,flight:30`. The generator resolves source
imports from the checkout. Preserve existing output names; use a new repeat ID.

The baseline commit is `94969b94d40bc30bf780c7da6db5e49d231cb720`.
`working-tree-source.patch` includes earlier retained fixes as well as this
follow-up; `retained-text.patch` isolates the new product/test change.
Additional untracked source snapshots retain their repository paths below
`patches/source-snapshots/`, with `.txt` appended.
