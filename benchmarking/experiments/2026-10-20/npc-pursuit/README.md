# NPC pursuit evidence — 2026-10-20

These artifacts support the [experiment report](../../../../docs/experiments/2026-10-20/npc-pursuit.md). They preserve the fixed quality fixtures, final controller, raw results, five alternating CPU pairs, validation logs, and resource measurements. Executables and rejected prototypes are omitted.

The baseline is the unchanged accepted [maneuver controller](../npc-maneuvers/sources/final-go.json.gz). The benchmark fixture and saved PGO are referenced from [pirate-cpu](../pirate-cpu/README.md). `sources/final.json.gz` contains all 350 captured Go files, TypeScript specs, and package metadata; `final-go.json.gz` contains the 255 Go entries for replay. Keep the captured generated catalog unchanged. `provenance.json` records source and executable identities; `manifest.json` hashes the archived files.

The primary ten moving-point cases improve from 30,883.8 to 20,361.7 accumulated excess distance beyond 300 units, a 34.07% reduction. Five additional blind cases were frozen before evaluating candidates. Across all fifteen moving-point cases the reduction is 28.18%; the fifteen physical-target cases improve 34.15%. The blind five-point tail score alone regresses 10.9%, while its mean following distance improves and no player escapes. Individual results remain visible in `quality/metrics.json` and the raw logs.

There are 46 scenarios: 30 five-minute curving pursuits, seven five-minute spinning-field courses, three five-minute circular orbits, three existing 35-second gap crossings, and three new 14-second physical-shape crossings. The new crossings use actual generated asteroid outlines and independently admit a 44-unit swept disk, while a smaller 36-unit disk is blocked by the radius approximation. Field positions, radii, outlines, and initial rotations are generated. Shape-specific and curving fixtures freeze spin; separate spinning-field courses retain it. No controller outcome selects their paths. The old controller fails the third new gap regression; the final controller crosses all three centrally without contacts. The spinning courses have one asteroid contact in 35 simulated minutes, compared with zero before.

`quality/final-equivalence.log` runs the final controller with a checked planner that compares each returned path against the preceding planner. All 198 paths are identical, and all 46 course metric lines match `quality/initial.log`. The checker's source and counters are retained with the fixtures. The final production source and CPU executable contain neither checker.

Final whole-session process CPU increases 4.73% across the sum of the five case medians. Fast combat maintains much closer contact: maximum separation falls from 832.5 to 293.7 units in the normal field and from 628.2 to 273.0 in the dense field. All fighting, firing, field, and fast-flight validity checks pass. The player inputs and benchmark remain unchanged; better NPC pursuit changes firing and physical interactions. CPU measurements use 9,000 measured ticks per case, five alternating pairs, production `GOGC=800`, automatic `GOMAXPROCS` (16), and identical PGO. `cpu-ns/tick` measures process user plus system CPU, excluding setup and warmup.

`checkpoints/initial` preserves the first integrated controller's raw three-pair diagnostic (+7.28% CPU) and the two-file source delta relative to the final controller. The before/initial dense-fast profiles identify added routing work. Later production cleanup preserves the trajectories. A bounded routing arithmetic trial was rejected because it changed two physical trajectories without reducing measured CPU.

The final client assets are byte-identical. The server grows 16,384 raw bytes and 5,891 gzip bytes. Resource gzip sizes use Python `gzip.compress(compresslevel=1, mtime=0)` for both checkpoints.

## Prepare and replay

Run from the repository root with Go 1.27.1 and the checkout's unchanged dependencies and assembly files. The existing preparation tool masks Go files added after each snapshot.

```sh
pursuitArtifacts=benchmarking/experiments/2026-10-20/npc-pursuit
pursuitPrevious=benchmarking/experiments/2026-10-20/pirate-cpu
node "$pursuitPrevious/prepare.ts" "$pursuitArtifacts/../npc-maneuvers/sources/final-go.json.gz" /tmp/npc-pursuit-before "$pursuitPrevious/fixtures/unicorn-cpu-final-fixture.go.txt"
node "$pursuitPrevious/prepare.ts" "$pursuitArtifacts/sources/final-go.json.gz" /tmp/npc-pursuit-final "$pursuitPrevious/fixtures/unicorn-cpu-final-fixture.go.txt"
CGO_ENABLED=0 GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-pursuit-before/overlay.json -pgo="$PWD/$pursuitPrevious/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-pursuit-before.test ./src/server/network
CGO_ENABLED=0 GOEXPERIMENT=simd go test -c -overlay=/tmp/npc-pursuit-final/overlay.json -pgo="$PWD/$pursuitPrevious/profiles/unicorn-cpu-default.pgo" -o /tmp/npc-pursuit-final.test ./src/server/network
GOGC=800 REPETITIONS=5 TICKS=9000 node benchmarking/tools/pirate-cpu.ts /tmp/npc-pursuit-before.test /tmp/npc-pursuit-final.test /tmp/npc-pursuit-rerun.json
```

Do not run builds, tests, compression, or profiles during paired timing. Paths and the local machine can change executable identities and performance.

For quality replay, add the same frozen fixtures to both prepared overlays:

```sh
node --input-type=module - "$pursuitArtifacts" /tmp/npc-pursuit-before /tmp/npc-pursuit-final <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [artifact, ...outputs] = process.argv.slice(2);
for (const output of outputs) {
  const path = resolve(output, 'overlay.json');
  const overlay = JSON.parse(readFileSync(path, 'utf8'));
  for (const [target, fixture] of [
    ['pursuit_risk_test.go', 'pursuit_risk_test.go.txt'],
    ['final_heldout_research_test.go', 'heldout_test.go.txt'],
    ['fresh_risk_research_test.go', 'fresh_test.go.txt'],
  ]) {
    overlay.Replace[resolve('src/server/npc', target)] = resolve(artifact, 'quality/fixtures', fixture);
  }
  writeFileSync(path, JSON.stringify(overlay));
}
JS
CGO_ENABLED=0 GOEXPERIMENT=simd go test -overlay=/tmp/npc-pursuit-final/overlay.json ./src/server/npc -run 'TestPursuitKeepsUp|TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes|TestPursuitMaintainsFastOrbits|TestFinalHeldOutCurvingPursuit|TestFreshRisk|TestGeneratedRiskGap|TestPursuitUsesPhysicalGaps' -count=1 -v
```

Run the same command against the before overlay for a matched baseline; its new mixed-resource gap is expected to fail. The other fixtures and budgets remain identical. To rebuild the initial checkpoint, pass its `source-changes.json.gz` to `prepare.ts` with `sources/final-go.json.gz` as the fourth, base-snapshot argument.
