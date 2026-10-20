# Pirate CPU evidence — 2026-10-20

This directory preserves the source checkpoints, raw measurements, profiles, and
quality fixtures from the pirate CPU investigation. The interpretation and final
acceptance comparison belong in the [experiment report](../../../../docs/experiments/2026-10-20/pirate-cpu.md). Intermediate
results are diagnostic checkpoints, not independent percentages to add together.

The final seventh checkpoint uses the frozen five-case fixture and five alternating
pairs. Its [raw results](results/unicorn-cpu-results-seventh.json),
[source and build provenance](provenance.json), and
[diagnostic profile metadata](profiles/unicorn-cpu-seventh-meta.json) identify the
exact source, executable, fixture, PGO input, environment, and commands.

Historical JSON, logs, profiles, source text, embedded paths, and metadata are
copied without rewriting their contents. Source JSON is stored with deterministic
gzip compression; decompressing it reproduces the exact original JSON bytes.
`manifest.json` records original paths and hashes. No executable is archived.

- `sources/` holds compressed Go and TypeScript spec checkpoints. The original
  baseline contains 234 Go files and 92 TypeScript specs. These include the
  generated Go catalog used by the server.
- `profiles/` holds the original PGO input and selected CPU/allocation profiles.
- `results/` holds raw paired CPU measurements, their logs, and quality runs.
- `fixtures/` holds immutable benchmark and held-out quality harnesses as text.
  This avoids treating historical Go fixtures as current packages.
- `provenance.json` maps checkpoints, executable hashes, source availability,
  profile inputs, and known limitations. `manifest.json` hashes the saved files.

The original three benchmark cases are `open`, `normal`, and `dense`. They run a
real session with one player and one fighting pirate, generated asteroids, actual
weapons/collisions, and packet construction through an in-memory socket. Inputs
arrive as decoded controls; binary control decoding, TCP transport, and network
timers are excluded. Each
timed batch lasts 900 ticks (30 simulated seconds); fresh-world setup and 120 warmup
ticks are excluded from the process CPU metric. The player holds thrust `0.3`,
flies straight for six seconds and turns at `0.4` for four seconds, repeatedly.
Later acceptance fixtures add separate full-thrust cases; they do not replace
the original cases.

The saved intermediate comparisons use 9,000 timed ticks per executable and
three repetitions, alternating execution order. `cpu-ns/tick` is process CPU
from `getrusage`, rather than wall-clock `ns/op`. Production settings are
`GOEXPERIMENT=simd`, `GOGC=800`, and automatic `GOMAXPROCS` (16 on the capture
host). CPU affinity and Go version are embedded in each result JSON. Firing and
wire-byte metrics provide workload checks. CPU profiles include setup and warmup;
the final saved reports use `-focus=tickSector -ignore=newPirateCombatBenchmark`
to restrict attribution to measured session ticks.

The initial comparison predates matched PGO builds. The second, cargo-cache
checkpoint has raw timing and profiles but no separately saved exact source
snapshot. The PGO-refresh comparison uses the same fourth source for both
executables and tests a different PGO input; it was not adopted. These limitations
are recorded explicitly rather than reconstructing unrecorded historical source.

## Reconstruct separate benchmark executables

Run from the repository checkout containing these artifacts. Use Go 1.27.1 and
the checkout's unchanged `go.mod`, `go.sum`, and assembly files. The captured base
commit and dependency hashes are recorded in `provenance.json`. The final after
snapshot contains Go source; shared TypeScript specs and the generated catalog
are frozen across the comparison. Do not regenerate the catalog: its captured
generated Go source is part of each snapshot.

`prepare.ts` extracts a source snapshot and writes a Go overlay. It also masks
every Go file added after that checkpoint, including new tests that refer to new
APIs, then supplies the exact same chosen benchmark fixture to both executables.
This prevents current tests or new production helpers from contaminating the
baseline. It writes only to the requested output directory.

```sh
artifact=benchmarking/experiments/2026-10-20/pirate-cpu
node "$artifact/prepare.ts" "$artifact/sources/unicorn-cpu-before.json.gz" /tmp/pirate-cpu-before "$artifact/fixtures/unicorn-cpu-final-fixture.go.txt"
node "$artifact/prepare.ts" "$artifact/sources/unicorn-cpu-seventh.json.gz" /tmp/pirate-cpu-seventh "$artifact/fixtures/unicorn-cpu-final-fixture.go.txt"
GOEXPERIMENT=simd go test -overlay=/tmp/pirate-cpu-before/overlay.json -pgo="$PWD/$artifact/profiles/unicorn-cpu-default.pgo" -c -o /tmp/pirate-cpu-before.test ./src/server/network
GOEXPERIMENT=simd go test -overlay=/tmp/pirate-cpu-seventh/overlay.json -pgo="$PWD/$artifact/profiles/unicorn-cpu-default.pgo" -c -o /tmp/pirate-cpu-seventh.test ./src/server/network
GOGC=800 REPETITIONS=5 TICKS=9000 node benchmarking/tools/pirate-cpu.ts /tmp/pirate-cpu-before.test /tmp/pirate-cpu-seventh.test /tmp/pirate-cpu-rerun.json
```

Use another saved source snapshot and the original three-case fixture to inspect
an intermediate stage. To reproduce the initial production-only checkpoint, pass the saved
baseline as the optional fourth argument to `prepare.ts`; it supplies the omitted
baseline tests and specs. Compile that initial comparison with `-pgo=off`.
For the PGO refresh experiment, compile fourth source twice, once using the
original PGO and once using `profiles/unicorn-cpu-dense-fourth.pprof` as `-pgo`.

Pass a fixture path as the third argument to select the later five-case benchmark.
Always select the same fixture for both variants. The archived result files keep
their original executable hashes; a reproduction at another output path can have
a different Go build identity and timings. Do not run builds, tests, compression,
or other CPU work concurrently with measured pairs.

The quality fixture in `fixtures/unicorn-cpu-final-heldout.go.txt` adds 14 curving
point/physical-target cases to the seven generated five-minute spinning courses.
Its saved before/current logs retain all per-case lag, escape, contact, stationary,
and survival measurements. To rerun it, add a Go overlay mapping from
`src/server/npc/final_heldout_research_test.go` in the checkout to a decompressed
copy of that fixture, then run `go test ./src/server/npc` with
`-run 'TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes|TestFinalHeldOutCurvingPursuit' -count=1 -v`.
