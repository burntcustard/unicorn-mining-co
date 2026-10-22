# Pirate combat CPU — 20 October 2026

> Evidence for this completed investigation is in the
> [2026-10-20 archive](../../../benchmarking/archive/README.md#2026-10-20).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-20`.

The final five-scenario combat benchmark uses **50.69% less process CPU** in
aggregate. Normal-field chases improve by about 54%; dense-field chases improve
by about 48%, so the dense cases remain slightly below the 50% target individually.
NPC steering still runs every 0.2 seconds. No movement tuning or dependencies
were changed for the retained optimizations.

## Final comparison

Each entry is the median of five alternating before/after runs, with 9,000 timed
ticks per run and case. CPU is user plus system process time per simulation tick.
The aggregate compares the sums of the five case medians, giving each scenario
the same number of simulated ticks; it is not a forecast of the live server's
particular mixture of encounters.

| Scenario                           | Before, µs CPU/tick | After, µs CPU/tick | CPU reduction | Allocations/tick, before → after |
| ---------------------------------- | ------------------: | -----------------: | ------------: | -------------------------------: |
| Open space                         |              42.044 |             20.110 |        52.17% |                         393 → 59 |
| Normal asteroid field              |              87.941 |             40.702 |        53.72% |                        560 → 102 |
| Dense asteroid field               |             106.134 |             55.017 |        48.16% |                        517 → 136 |
| Normal field, full-throttle player |              94.532 |             43.694 |        53.78% |                        564 → 102 |
| Dense field, full-throttle player  |             120.847 |             63.129 |        47.76% |                        543 → 139 |

[Raw final results](../../../benchmarking/archive/README.md#2026-10-20)
and their ten companion logs retain every sample. Allocation counts decrease
by 74–85%. The five-case mean of the individual percentage reductions is 51.12%;
the aggregate CPU reduction above uses the ratio of summed medians instead.

## Workload and measurement limits

`BenchmarkPirateCombat` runs one actual player Courser and one pirate through
`GameSession.Receive` and `GameSession.Tick`. It includes input handling in
session state, normal pirate decisions, generated field streaming, ship movement,
weapons, collisions, cargo/module replication, snapshot construction and input
acknowledgments. The in-memory controls/socket sink excludes binary control
decoding, TCP writes and timer scheduling.
These numbers measure combat session work, not the idle HTTP server or socket
transport overhead. They are not reductions in the steering function alone.

Each timed batch covers 30 simulated seconds, after a four-second warmup in a
fresh world. World construction and warmup are outside the CPU counter and Go
benchmark allocation timer. Enlarged health, ammunition and replenished fuel keep
both ships alive and combat active. Resetting worlds prevents repeated calibration
from destroying the field or drifting into empty space.

The original three cases retain their original inputs: thrust 0.3, six seconds
of straight flight followed by four seconds turning at 0.4, with weapons active.
Two additional cases use full player thrust with that same input pattern. The
fast players average 192.0 and 179.4 units/second; pirates average 169.6 and 173.9.
Both fast players remain within their generated field throughout the measured
batch. Normal-fast includes a brief loss of visibility and pursuit before combat
resumes; dense-fast remains fighting throughout. All cases fire weapons.

Every reported activity metric matches between the final before/after runs:
asteroid population, player/pirate speed, firing and fighting fractions, maximum
separation, field presence and outgoing byte counts. The fixtures also reject
ended combat, dead ships, and fast cases that fail their speed/field/activity
checks.

Both executables use Go 1.27.1, `GOEXPERIMENT=simd`, the same saved production PGO
profile, and production `GOGC=800`. Go scheduling remains automatic: 16 scheduler
threads and CPU affinity 0–15 on the capture host. Runs are sequential and
alternate execution order, without concurrent builds, tests, profiles or archive
compression. The PGO profile was held constant throughout acceptance measurements.

## Retained changes

- NPC forecasts share engine parameters and moving/spinning obstacle poses across
  candidate controls. Throttle candidates share their turning forecast, and the
  pilot reuses forecast storage across decisions. A candidate skips detailed
  geometry only when its endpoint penalty proves it cannot beat an already safe
  candidate.
- Navigation uses squared-distance broad phases and a typed A* heap. Asteroids
  share their existing local outline; queries transform endpoints instead of
  rebuilding every rotated vertex. Procedural outline cleanup is cached once.
- Snapshots reuse unchanged nested cargo payloads and stable module layouts,
  including mount indexes. Mutable cargo is still inspected each batch. String
  comparisons avoid boxing unchanged values, and UTF-16 encoding avoids temporary
  rune/code-unit arrays while retaining exact wire bytes.
- Settled portal hulls and projectile sweep shapes reuse geometry under explicit
  invalidation tokens. Permanently nonphysical empty bodies do not wake asteroid
  fixtures. Physical ships retain wake participation while their fixtures are
  temporarily absent during transit or docking.
- Collision sorting retains its order across body additions/removals, avoiding
  a full sort on projectile births and deaths. Entity scheduling resolves limited
  observer positions and update cadence once. Region queries reuse output buffers
  without changing owned-query results. Ship power/module updates use the existing
  stack-buffer pattern, with ordinary slice growth for larger ships.

No lower ship speed, slower firing, reduced physics cadence, or slower steering
was used to obtain the final result. Movement settings remain response time 0.5,
prediction time 2, clearance distance 3, and decision interval 0.2 seconds.

## Validation and rejected alternatives

All 21 five-minute generated obstacle-course replays pass: seven spinning fields,
seven moving-point pursuits and seven physically simulated ship pursuits. Across
105 simulated minutes, all logged pursuit distance, excess lag, visibility,
collision and stationary metrics match the starting implementation. Spinning
and point courses have zero asteroid contacts. Physical pursuits have four
asteroid and seven ship-contact episodes across 35 minutes, no time beyond the
700-unit firing range, and no deaths or stranding. The point courses retain their
baseline 4.9 seconds outside that range. No prolonged stalls occur.

The final [quality replay log](../../../benchmarking/archive/README.md#2026-10-20)
and saved baseline/current logs retain the measurements. The allocation-only
stack-buffer change leaves iteration order and behavior unchanged; the complete
NPC suite also passes after it.

The complete test suite passes: 68 Node checks and all Go server packages.
Production builds, full lint, the explicit Go formatter check for all 41 changed
Go files, and `git diff --check` pass. Added regressions cover mutable/nested cargo,
module remounting and cooldowns, exact Unicode encoding, geometry invalidation,
projectile movement clamps, observer scheduling, owned regional views and changing
collision body populations.

The first empty-fixture optimization exposed a jump-gate parity regression when
a ship reappeared after transit. Restricting the exclusion to nonphysical bodies
fixed it. Both transit directions now have a focused regression, and the complete
client/server gate parity fixture passes unchanged.

Longer steering intervals were tested with the actual derived scheduling cadence.
Intervals of approximately 0.267 and 0.3 seconds increased pursuit lag and time
outside firing range, so the 0.2-second interval was retained. A refreshed PGO
profile gave no useful normal-field gain and regressed the dense case; the original
profile remains in production. Grouping asteroid segment fixtures would change
contact and damage mechanics and was not adopted.

## Resources and reproduction

All 14 client build resources are byte-identical to the baseline: 302,311 raw
bytes and 129,919 gzip bytes. The stripped server grows from 13,291,680 to
13,308,064 bytes (+16,384, approximately 0.12%). Consistent Python gzip level 1
measurements grow by 8,021 bytes. These comparisons use preserved baseline
artifacts, rather than the development watcher's executable.

The [evidence archive and reproduction instructions](../../../benchmarking/archive/README.md#2026-10-20)
include the original dirty-workspace baseline, final source snapshot, pinned
five-case fixture, shared PGO input, raw timing logs, quality harnesses, diagnostic
profiles and hashes. The overlay builder reconstructs separate before/after test
executables without changing the checkout. Intermediate checkpoints are preserved
as diagnostics, including their source gaps and differing measurement settings;
their percentages should not be added together.
