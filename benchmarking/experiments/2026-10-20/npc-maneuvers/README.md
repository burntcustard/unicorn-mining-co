# NPC maneuver evidence — 2026-10-20

These artifacts support the [experiment report](../../../../docs/experiments/2026-10-20/npc-maneuvers.md). They preserve the task's starting controller, final controller, common corrected reference routes, raw quality results, five alternating CPU pairs, validation logs, and resource measurements. No executables or rejected tuning variants are archived.

`checkpoints/initial-accepted` preserves the preceding accepted source and measurements before three redundant scalar-buffer clears were removed. Its provisional CPU result is separate from the final comparison. All 33 movement-case metrics match between those checkpoints.

`provenance.json` records source and executable identities, the unchanged benchmark and PGO inputs, environment, and aggregate metrics. `manifest.json` hashes every saved artifact. Full snapshots in `sources/{before,final}.json.gz` retain Go files, TypeScript specs, and package metadata; `*-go.json.gz` contains the same Go entries for the existing overlay preparation tool. The generated catalog is captured source: do not regenerate it when replaying either checkpoint. Use the checkout's unchanged dependencies and assembly files.

Both quality checkpoints use the fixtures in `quality/fixtures`. Their 44-unit reference envelope contains the Courser's physical navigation circle and clearance. Straight crossings use generated gaps that admit this circle, rather than polygon recesses. An independent reference-generator correction preserves continuous velocity at near-hairpin turns. The same corrected fixtures were run against both production checkpoints; absolute lag, contact, and stall budgets remain unchanged. Historical claims about tenfold improvement on different routes are not reused.

The final 19 permanent cases and 14 held-out cases pass. Across the 20 curving cases, integrated lag beyond 300 units decreases from 94,227.9 to 69,894.6; time beyond 700 units decreases from 75.63 to 25.39 seconds. Individual cases can regress. There is one asteroid contact across these courses in each checkpoint; all seven spinning-field courses finish without contacts.

CPU measurements use the unchanged five-case session fixture, 9,000 measured ticks per case, five alternating pairs, production `GOGC=800`, automatic `GOMAXPROCS` (16 on this host), and the same saved PGO. `cpu-ns/tick` measures process user plus system CPU, excluding fixture setup and warmup. Player inputs remain identical; NPC motion, firing, and resulting physical interactions can differ. All firing, fighting, field, and fast-flight validity checks pass. The sum of per-case CPU medians decreases 2.82%; the open and dense-fast cases regress slightly. Resource gzip sizes use Python `gzip.compress(compresslevel=1, mtime=0)` for both checkpoints.

## Prepare and replay

Run from the repository root with Go 1.27.1. Reuse the prior experiment's source-overlay tool and saved PGO without changing those historical artifacts:

```sh
artifact=benchmarking/experiments/2026-10-20/npc-maneuvers
previous=benchmarking/experiments/2026-10-20/pirate-cpu
node "$previous/prepare.ts" "$artifact/sources/before-go.json.gz" /tmp/npc-maneuvers-before "$previous/fixtures/unicorn-cpu-final-fixture.go.txt"
node "$previous/prepare.ts" "$artifact/sources/final-go.json.gz" /tmp/npc-maneuvers-final "$previous/fixtures/unicorn-cpu-final-fixture.go.txt"
GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-maneuvers-before/overlay.json -pgo="$PWD/$previous/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-maneuvers-before.test ./src/server/network
GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-maneuvers-final/overlay.json -pgo="$PWD/$previous/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-maneuvers-final.test ./src/server/network
GOGC=800 REPETITIONS=5 TICKS=9000 node benchmarking/tools/pirate-cpu.ts /tmp/npc-maneuvers-before.test /tmp/npc-maneuvers-final.test /tmp/npc-maneuvers-rerun.json
```

Do not run builds, tests, compression, or profiles during the paired measurements. Output paths and the local machine can change executable identities and timing.

For quality replay, add the common corrected fixtures to both prepared overlays. The source preparation already masks Go files added after each checkpoint, including new helpers and tests that would otherwise alter or fail the baseline.

```sh
node --input-type=module - "$artifact" /tmp/npc-maneuvers-before /tmp/npc-maneuvers-final <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [artifact, ...outputs] = process.argv.slice(2);
for (const output of outputs) {
  const path = resolve(output, 'overlay.json');
  const overlay = JSON.parse(readFileSync(path, 'utf8'));
  for (const name of ['pursuit_course_test.go', 'pursuit_gaps_test.go', 'maneuvers_course_test.go']) {
    overlay.Replace[resolve('src/server/npc', name)] = resolve(artifact, 'quality/fixtures', `${name}.txt`);
  }
  overlay.Replace[resolve('src/server/npc/final_heldout_research_test.go')] = resolve(artifact, 'quality/fixtures/heldout_test.go.txt');
  writeFileSync(path, JSON.stringify(overlay));
}
JS
GOEXPERIMENT=simd go test -overlay=/tmp/npc-maneuvers-before/overlay.json ./src/server/npc -run 'TestPursuitKeepsUp|TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes|TestPursuitMaintainsFastOrbits|TestFinalHeldOutCurvingPursuit' -count=1 -v
GOEXPERIMENT=simd go test -overlay=/tmp/npc-maneuvers-final/overlay.json ./src/server/npc -run 'TestPursuitKeepsUp|TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes|TestPursuitMaintainsFastOrbits|TestFinalHeldOutCurvingPursuit' -count=1 -v
```
