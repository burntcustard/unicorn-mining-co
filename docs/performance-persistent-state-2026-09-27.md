# Persistent replication and movement storage, 27 September 2026

Follow-up to [the phase investigation](performance-server-phases-2026-09-27.md).
Baseline: `442548e1fb663d5d4d75c5747c866a299b4f78bc`.

`fly.toml` now sets `NODE_OPTIONS=--max-semi-space-size=16`. The existing heap
experiment was reused; all implementation comparisons below use 16 MiB on both
sides, so they do not count the heap-setting benefit again. Nothing was deployed.

## Retained implementation

### Replication

Each entity now owns a persistent record through a WeakMap. Its field readers
are created once. Unchanged scalar values, vector copies and segment comparison
copies survive across ticks; changed fields advance revisions. Each observer
retains a cursor, rather than another complete normalized field dictionary.
Current-state preparation is still shared between players in the same tick.

The readers still inspect mutable source values. This deliberately avoids a
large, fragile set of gameplay dirty flags which could miss an in-place edit.
The expensive work—constructing full records, copying unchanged values and
performing the same deep comparison separately for every receiver—is removed.

Craft module snapshots also survive across ticks. Their source modules, mount
indices, health, shades, identity and segment activation values are checked
before rebuilding. Owned snapshot arrays are immutable, so their JSON comparison
encoding can be reused safely. Full outgoing packets are still encoded normally.

Observer cursors are removed when entities leave visibility and reset on initial
load. Disconnect now releases the observer's history immediately, rather than
retaining references to old entities until the reconnect token expires.
Records are keyed by entity identity, not just numeric ID. A replacement under
an existing ID sends a complete record plus explicit clears for old optional
fields: the actual receiver merges records even when `kind` is present.

Revision tracking is conservative. A field changed and restored between an
observer's updates can produce a redundant delta/clear. Across the three measured
routes this added **410 bytes to about 40.6 MB** of packets. It does not change
receiver state. This avoids keeping another full value history per observer.

### Entity updates and world bookkeeping

Per-world scheduling entries, observer/carrier arrays and previous-transform
storage are reused. Entries are refreshed on every call and removed/shrunk as
entities disappear. Partial input subdivisions, observer tiers, entity order,
physics intervals and numeric rounding are unchanged.

The base movement update skips angular damping when drag is zero. It also skips
linear damping/scaling after a below-threshold velocity has already been set to
zero. Rotation, decay, carrier movement and final rounding still execute.
A stationary entity is not assumed to have no gameplay work.

The earlier 13% movement figure meant approximately 0.1 ms of foreground work
per server tick across the entire three-player world, not 13% utilization of a
CPU core. Allocation and dispatch around the arithmetic were worth reducing,
even though the arithmetic itself is small.

## Staged measurements

Production minification, three players, convoy/spread/contact routes, pinned to
the same two physical cores on a Ryzen 7 5800X3D with Node 26.8.2. Two runs per
stage per route, forward/reverse stage order. Each child has a 120-second
measured replay and one warm replay: 260 simulated seconds including startup,
with a 290-second wall timeout. No 20-minute tests were run.

| Route   | Baseline CPU ms/tick | After replication | After movement | Combined reduction |
| ------- | -------------------: | ----------------: | -------------: | -----------------: |
| Convoy  |               0.6380 |            0.6167 |         0.6141 |               3.8% |
| Spread  |               0.9343 |            0.8982 |         0.8810 |               5.7% |
| Contact |               0.8237 |            0.7906 |         0.7305 |              11.3% |

Replication alone saved 3.3–4.0%; the movement stage added 0.4–7.6% relative to
that stage. GC event counts over whole warmed children fell approximately
21–23% from baseline to the retained implementation. Maximum observed process
RSS in this comparison was 169/214/190 MiB after changes versus 168/215/217 MiB
before; these short measurements do not establish long-session memory bounds.

These are actual process CPU measurements of accelerated local production-build
replays, not estimates of deployed Fly savings. The benchmark uses simulated
sockets and includes packet serialization/hashing, not real network transport.
The added caches are bounded by retained entities/observers/worlds and do not
reserve four times the application's memory.

A separate ABBA confirmation of the final replication/movement code gave:

| Route   | Baseline CPU ms/tick | Retained CPU ms/tick | Reduction |
| ------- | -------------------: | -------------------: | --------: |
| Convoy  |               0.6583 |               0.6225 |      5.4% |
| Spread  |               0.9447 |               0.8674 |      8.2% |
| Contact |               0.8133 |               0.7427 |      8.7% |

The two series both show a gain, with ordinary run-to-run variation in its size.
The same-ID replacement guard was included in this confirmation. Disconnect
history release is a cold-path cleanup, not exercised by these flight replays.

## Region work: three approaches rejected

The third priority was implemented and tested after the movement stage:

1. Cache exact query membership until the triangle inequality proves that an
   observer could reach the nearest range boundary. Skip unchanged procedural
   reconciliation, while still checking missing managed sources and sleepers.
2. Preserve result-list identity when a conservative distance budget expires
   but membership did not change.
3. Remove the geometric cache entirely and compare source-ID lists on the
   server before deciding whether reconciliation is needed.

All preserved routes and passed range/removal/observer-change correctness
oracles, but the CPU result was not reliable. The first geometric cache was
about 4.9% slower on spread in the staged comparison. The refined version was
4.1% slower on spread in its paired comparison. Even the simpler server-only
version used 0.8927 versus 0.8565 ms/tick on spread, **4.2% worse**.

All region changes were reverted, including their extra shared-code complexity.
The unchanged scans are currently cheaper than the tested bookkeeping. This is
not a claim that region work is optimal; a future attempt should target actual
creation/sleeping costs or remove allocation without another membership cache.

## Other V8 options

`--single-threaded-gc` was tested in ABBA order on all three routes using the
intermediate geometric-cache build. It reduced total CPU 6.4% on spread, but
increased it 2.9% on convoy and 1.8% on contact. GC elapsed duration increased in
all routes. Worst measured ticks grew from 1.95/8.04/6.93 ms to
3.91/11.67/12.54 ms respectively. It was not retained. This flag is also not
accepted in `NODE_OPTIONS` by the tested Node version; a deliberate command-line
change would be needed to try it in deployment.

Local V8 defaults already enable concurrent marking and parallel scavenging.
`--optimize-for-size` is already off and favors memory size over speed;
`--jitless` removes JIT compilation. Neither is a sensible CPU-saving default
for this workload. Increasing `--max-old-space-size` is a different experiment
from the successful young-generation change, and no evidence here establishes
an old-space-limit bottleneck. No additional flags were enabled.

Node treats most raw V8 flags as implementation details rather than a stable
API. See [Node CLI documentation](https://github.com/nodejs/node/blob/main/doc/api/cli.md)
for supported memory options and V8 flag caveats.

## Correctness and artifacts

The independent replication oracle compiles the previous replication source
alongside the new implementation, feeds both the same world, then reconstructs
receiver records using the client's merge/null-clear semantics after every
packet. It checked **35,109 snapshots** across the three routes, with identical
receiver state throughout. There were 43 conservative delta differences.
Trajectories, packet counts and final/maximum entity counts also matched.

Regression cases cover same-tick changes, independent observer histories,
cleared values, same-ID replacements, mutable asteroid geometry and module
health/activation/shades/identity changes. A production-mangling test confirms
that ten unchanged module snapshots perform zero module-array comparison
serializations, while subsequent mutations still produce correct deltas.

`npm test` (including production build) and `npm run lint` passed after the
replacement and disconnect fixes. Changed files pass formatting and
`git diff --check`. Loading boundaries and packet format are unchanged.

| Resource  | Before raw / gzip-1 bytes | After raw / gzip-1 bytes |
| --------- | ------------------------: | -----------------------: |
| Main JS   |           94,647 / 42,093 |          94,929 / 42,239 |
| Server JS |           76,964 / 33,397 |          78,285 / 33,957 |
| Docked JS |             4,740 / 2,446 |            4,740 / 2,447 |
| Sound JS  |               1,681 / 942 |              1,681 / 942 |
| HTML      |             3,986 / 1,951 |            3,986 / 1,950 |

The existing main-bundle 14 KB warning remains. No CPU tier, VM memory, package
dependencies, physics frequency or deployment was changed. Only the approved
semi-space option was added to the Fly environment.

Raw staged and rejected-experiment measurements:
[benchmark results](../benchmarking/results/2026-09-27-persistent-state.json).
Reproduction commands: [benchmarking README](../benchmarking/README.md).
