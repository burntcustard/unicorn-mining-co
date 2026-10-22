# NPC maneuver evidence — 2026-10-20

The completed experiment's source snapshots, captures, profiles, images, patches,
and original reproduction instructions are preserved in
[the 2026-10-20 archive](../../../archive/README.md#2026-10-20).

From the repository root, restore the evidence into ignored scratch storage:

```sh
node benchmarking/tools/extract-experiments.ts 2026-10-20
```

The experiment tree extracts under `benchmarking/local/restored/`, including
its README, report, and required inputs.
Use the recorded source revision and toolchain when reproducing measurements.
