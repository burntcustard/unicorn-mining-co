# NPC clearance experiment — 2026-10-20

This read-only experiment supports the [report](../../../../docs/experiments/2026-10-20/npc-clearance.md). Production keeps `clearanceDistance: 1`. The candidate removes the property entirely, including its Go schema, generated catalog, routing, avoidance, and predictor arithmetic. It retains overlap escape scoring and adds no replacement margin.

Both the accepted and zero-clearance configurations pass all NPC tests, including 19 permanent movement cases and 14 held-out courses. The full-removal candidate reproduces all 33 zero-catalog movement metrics exactly. Results are mixed: held-out pursuit improves, but the combined 20 curving courses increase integrated lag beyond 300 units from 69,894.6 to 73,738.2 and time beyond 700 units from 25.39 to 30.84 seconds. Asteroid contacts remain one; ship contacts decrease from 13 to 12. The seed9 physical-target case accounts for most of the regression.

Five alternating CPU pairs use identical input scripts, the saved production PGO, `GOEXPERIMENT=simd`, `GOGC=800`, and automatic `GOMAXPROCS` (16 on the host). Whole-session CPU increases 3.11% overall; per-case results and activity checks are preserved in `cpu/`. NPC behavior changes, so these measurements do not isolate the cost of the removed arithmetic. No executable or redundant full baseline snapshot is stored.

`candidate.json.gz` contains eight source replacements. The unchanged accepted baseline and benchmark fixture are referenced from the preceding experiments. `provenance.json` identifies source, executable, fixture, PGO, environment, and metrics; `manifest.json` hashes the saved evidence. The four quality logs, per-case metric tables, and full-removal equivalence log are under `quality/`.

To reconstruct the CPU binaries, run from the repository root with Go 1.27.1 and the checkout's unchanged dependencies and assembly files:

```sh
artifact=benchmarking/experiments/2026-10-20/npc-clearance
baseline=benchmarking/experiments/2026-10-20/npc-maneuvers/sources/final-go.json.gz
previous=benchmarking/experiments/2026-10-20/pirate-cpu
fixture="$previous/fixtures/unicorn-cpu-final-fixture.go.txt"
node "$previous/prepare.ts" "$baseline" /tmp/npc-clearance-before "$fixture"
node "$previous/prepare.ts" "$artifact/candidate.json.gz" /tmp/npc-clearance-after "$fixture" "$baseline"
GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-clearance-before/overlay.json -pgo="$PWD/$previous/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-clearance-before.test ./src/server/network
GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-clearance-after/overlay.json -pgo="$PWD/$previous/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-clearance-after.test ./src/server/network
GOGC=800 REPETITIONS=5 TICKS=9000 node benchmarking/tools/pirate-cpu.ts /tmp/npc-clearance-before.test /tmp/npc-clearance-after.test /tmp/npc-clearance-rerun.json
```

Run paired measurements without concurrent builds, tests, profiles, or compression. The saved held-out fixture is unchanged from the prior experiment; its source and preparation instructions are linked through `provenance.json` and the baseline archive.
