# Collector cleanup investigation, October 30, 2026

Collectors now clean up the complete 35-item in-range cohort more than twice as
fast as the baseline's observed lower bound. The baseline left one item after
1,800 simulated seconds. The final normal server recorded all 35 pickups by
**645.9 seconds**, confirmed all items held at the **650-second** snapshot, and
confirmed all station deposits at **745 seconds**. No in-range loose or missing
items remain. Full tests, build, lint, and formatting pass.

The matched early 300-second normal-server CPU window used **14.9% more CPU**,
rising from **0.608% to 0.699% of one core**, while collecting 25 items versus 18.
The faster cleanup
is not a demonstrated normal-server CPU saving. This report retains the rejected
variants as well as the successful replay.

The earlier [collector implementation report](2026-10-30-collector-npcs.md)
describes the original feature checks and separate artificial fixture benchmarks.
Those measurements remain historical and are not the baseline for this task.

## Real debris generation

The local world was reset once, with the Go watcher stopped. Live data was not
changed. The normal frontend and Go watcher used ports 3000 and 3001. The Go
server used `GOMEMLIMIT=300MiB`, default `GOGC=100`, and two logical CPUs during
the mining case.

The unchanged standard `module` workload prepared 32 players against distinct
real asteroids. All 32 passed the normal physical approach and mining-start
checks after the 15-second warmup. The case retained its 180-second measurement
configuration, then received SIGINT after **150.035 seconds of actual mining**.
The normal interruption handler closed the miners' sockets and preserved the
debris. No ore was fabricated and no inventory was dropped to enlarge the cohort.

Generation initially targeted a 60-second interruption. There were only 12 loose
items at about 46 seconds and 26 at about 98 seconds, so the same running workload
continued to 150 seconds. Only the wrapper process was paused to delay its timer;
the standard benchmark, miners, and server continued normally. The wrapper's
legacy console line still says 60 seconds; its timestamp manifest and
`mining-extension.json` record the actual duration. There was a 96.123-second gap
in intermediate CPU sampling, but cumulative process counters span that gap.

One existing user connection was present during preparation and disconnected
before the mining capture ended. All 32 miners disconnected at tick **21162**,
leaving zero connected players. The normal three-second ship-hide cooldown was
due around tick 21252 and completed before the checkpoint. Their debris contained
gold, opal, amethyst, and diamond:

| Fixed initial scope                                                    | Count |
| ---------------------------------------------------------------------- | ----: |
| All eligible loose items                                               |    40 |
| Within at least one discovered station's 10,000-meter operating radius |    35 |
| Outside every discovered station's operating radius                    |     5 |

The primary cohort is those same 35 in-range IDs throughout every replay.
Separate manifests retain all 40 IDs and the five outside-range IDs. Later loose
items do not replace failed cohort items or enlarge the denominator. No items
had been collected when the checkpoint was frozen.

The mining-generation window used 10.970 Go-process CPU-seconds over 150.173 wall
seconds, or 7.305% of one core. Its first counter sample preceded the measurement
marker by 138 ms; the end sample matched interruption, and process-counter
granularity contributes about 20 ms uncertainty. This is a generation workload
measurement, not a collector optimization comparison.

## Checkpoint and comparison method

After the hide cooldown, the watcher shut down gracefully and flushed
persistence. The closed checkpoint is
`benchmarking/_local/collector-cleanup/checkpoint/world.sqlite`, 6,172,672 bytes,
with database SHA-256:

```text
48f129c52b7ad6f4a86c9565c5fd4d1c2f94ea830aceac7db1b96cd84396dd7b
```

Every variant receives a temporary clone of that checkpoint. The baseline source
archive SHA-256 is
`fc75543b5a62f05e7887e3f861327c7e053ad3db5af52cd22e679ff04748259b`.
Separate compiler overlays freeze the original pilot and the exact assignment
variant, preventing later source edits from leaking into earlier comparisons.
Each overlay includes a per-file SHA manifest and an archived copy under
`benchmarking/_local/collector-cleanup/`.

Later checkpoint inspection created an empty WAL and a shared-memory sidecar.
The original replay checksum included those sidecars, producing a different
bundle digest despite an unchanged database. This was verified byte for byte;
the summaries now distinguish the main database SHA from the legacy bundle SHA
and retain per-file provenance in `checkpoint-provenance.json`. No gameplay
results were changed by that metadata correction.

The accelerated replay advances the complete game session with the normal
1/30-second physics step and 0.2-second NPC decision interval. Synthetic wall
time preserves normal persistence scheduling. It does not accelerate ship
movement, shorten inspection or pickup timeouts, increase cargo capacity, or
prime item ages. Future station intervals use the same documented test-only
SplitMix64 fraction of simulation tick XOR world seed in every variant. The
configured 120–300-second interval range remains unchanged, and the already
saved first check times are retained. Launch spacing remains five seconds.

The current replay harness is in `benchmarking/npc/replay`; see
[`benchmarking/README.md`](../../benchmarking/README.md) for its current command.
Historical source snapshots, commands, and results below describe the original
measurement and remain unchanged by the package reorganization.

Ordinary restart semantics round saved positions, discard transient objects,
park disconnected player ships, and rebuild navigation caches. Thus the
controlled comparison starts from the same restored checkpoint, rather than
claiming a bit-for-bit continuation of the pre-shutdown simulation. The initial
checkpoint tick is **23201**, 67.967 simulation seconds after miner disconnect.

T50, T90, and T100 require confirmed collector pickups still held by collectors
or station inventories, sampled once per simulation second. Exact individual
pickup events are also retained. Unexplained disappearance, pirate pickup, and
a subsequent cargo drop cannot satisfy completion. Depositing all cargo is a
separate milestone. Passive real-server tooling records five-second world
snapshots and exact event ticks. Cleanup comparisons use simulation ticks;
elapsed wall time across checkpoint downtime is not a cleanup metric.

## Baseline and variants

All times in the following table are simulated seconds from the restored
checkpoint. Every variant's first collector launches at 205 seconds; the main
station begins launching at about 370.267 seconds. Baseline repetition reproduced
the same pickup counts, residual item, and T50/T90 milestones.

| Variant                                                       | T50 |   T90 |   T100 | Cohort collected/held | Diagnostic CPU seconds | Simulated CPU window |
| ------------------------------------------------------------- | --: | ----: | -----: | --------------------: | ---------------------: | -------------------: |
| Baseline: radial lists, original pilot                        | 494 |   802 | >1,800 |                 34/35 |                  2.929 |              1,800 s |
| Baseline repeat                                               | 494 |   802 | >1,800 |                 34/35 |                  2.938 |              1,800 s |
| Final baseline with the final replay harness                  | 494 |   802 | >1,800 |                 34/35 |                  2.949 |              1,800 s |
| Neighbor grouping + reservations, original pilot              | 444 | 1,091 | >1,800 |                 33/35 |                  3.266 |              1,800 s |
| Neighbor grouping + reservations + nearby-pickup pilot change | 444 |   893 | >1,800 |                 34/35 |                  4.305 |              1,800 s |
| Neighbor grouping only, original pilot                        | 444 |   822 |  1,344 |                 35/35 |                  4.641 |              1,800 s |
| Reservations only, radial lists and original pilot            | 494 |   981 |  1,063 |                 35/35 |                  2.639 |          **1,128 s** |
| Nearby-pickup pilot change only, radial lists                 | 468 |   844 | >1,800 |                 34/35 |                  3.730 |              1,800 s |
| Farthest-seed grouping + reservations, original pilot         | 479 | 1,046 | >1,800 |                 33/35 |                  3.480 |              1,800 s |
| Farthest-seed grouping + provisional stall recovery           | 452 |   883 | >1,800 |                 33/35 |                  6.483 |              1,800 s |
| Farthest-seed grouping + revised stall recovery               | 452 |   717 | >1,800 |                 34/35 |                  5.785 |              1,800 s |
| Radial lists + reservations + revised stall recovery          | 468 |   575 | >1,800 |                 34/35 |                  1.690 |              1,800 s |
| Radial lists + reservations + recovery + boundary braking     | 457 |   565 |    646 |                 35/35 |                  1.640 |              1,800 s |
| Same boundary behavior, conservative interior forecast gate   | 457 |   565 |    646 |                 35/35 |                  1.689 |              1,800 s |
| Boundary gate + first open-space pirate recovery correction   | 461 |   817 |  1,382 |                 35/35 |                  2.648 |              1,800 s |
| Boundary gate + recovery based on working throat geometry     | 457 |   565 |    646 |                 35/35 |                  1.666 |              1,800 s |

Neighbor grouping forms each trip from nearby items instead of sorting every
trip only by distance to the station. Reservations suppress repeat assignments
for that station's unfinished active and queued trips. The nearby-pickup pilot
change allows local collection steering during a close navigation detour.
Farthest-seed grouping starts each six-item trip at the farthest remaining item,
then adds the nearest neighbor repeatedly. Stall recovery tests add a new
approach after failed progress and account for the simulation's minimum movement
speed. These are successive frozen variants, not interchangeable pilot versions;
their source archives identify the exact code used.

The baseline's last successful cohort pickup was at 820.767 seconds. Item
`281474976712116` remained near (-2892, 1262). Two Finches each spent most of a
five-minute attempt circling that item. At the end there were no active or queued
collectors and only two total in-range loose items, below the three-item dispatch
threshold. This is a persistent residual, not a successful 820.767-second T100.

The combined assignment change improved the median-progress milestone but
worsened T90, diagnostic CPU, and completion count. It is not accepted as a
cleanup improvement. The nearby-pickup change collected the baseline's missed
item but left a different item, `281474976712196`, near (-5194, -1577).
Neighbor grouping and reservations separately completed the cohort, but neither
met the twofold target. Grouping deposited all cohort cargo at 1,513 seconds;
reservations did so at 1,128 seconds.

Farthest-seed grouping shortened unobstructed route estimates but still failed
the full physical replay. Revised stall recovery improved T90 to 717 seconds
with that grouping and 575 seconds with radial lists and reservations. Both
still left one cohort item, so neither meets the full-cleanup target. The radial
variant's last successful pickup was at 657.367 seconds; it left item
`281474976711539`. That successful-pickup time is not its T100.
Its Finch crossed the operating boundary at 454 seconds, reaching 10,028.64
meters from home while still carrying only one item. The controller then
correctly ordered a return. This identifies a boundary-braking failure separate
from the close pickup failures in the farthest-seed variant.

Predicting where the Finch will stop and braking before it leaves its operating
radius resolves that final failure. The actual-position boundary check still
orders a return if an external force pushes a collector outside. The pickup list
and attempt timeout continue through the temporary course correction. With
radial lists, station-local reservations, and revised pickup recovery, the full
cohort clears by 646 seconds and reaches station inventories by 744 seconds.
The last exact pickup occurs at 645.867 seconds. No in-range loose items remain;
the five initially excluded outside-range items are still present.

The selected implementation skips the precise stopping forecast when a cheap,
conservative full-thrust-and-coast bound cannot reach the boundary. It reproduces
the same 646/744-second pickup/deposit milestones. The two diagnostic CPU totals
are too close, and in the wrong direction, to claim an incremental CPU saving
from this gate. Unused farthest-seed grouping code and tests were removed; the
current dispatch retains radial sorting and station-local reservations.

Broader seeded pirate checks found that the revised recovery radius could end
an open-space alignment too early. Restricting the larger recovery radius to a
blocked escape fixed those focused pirate checks, but the complete collector
replay regressed to T90=817, T100=1,382, and all deposits at 1,442 seconds. This
version is not accepted as meeting the twofold cleanup objective.

The final recovery rule uses the ship's functioning pickup centers: opposing
side throats can collect during the broad turn, while a centered throat retains
the full alignment. This preserves the Finch's successful path without a
ship-name special case and passes the twelve seeded pirate pickup checks. Its
full cohort replay again reaches T50/T90/T100 at 457/565/646 seconds, with all
deposits at 744 seconds.

From first launch, baseline T50 is 289 seconds and T90 is 597 seconds; T100 is
greater than 1,595 seconds. Grouping's active T100 is 1,139 seconds, and
reservations' active T100 is 858 seconds. Neither establishes a twofold reduction
in active cleanup time.

These CPU values measure the accelerated test process, including diagnostic JSON
and asynchronous persistence. They are CPU-seconds of work, not real-server CPU
percentages. The reservations run stopped after deposit at 1,128 seconds, so its
lower total cannot be compared directly with the 1,800-second baseline. The
harness now retains the full requested horizon after successful cleanup; final
baseline and candidate CPU captures must use the same fixed horizon and
instrumentation.

The final baseline rerun reproduces 34/35 completion and the same 494/802-second
milestones with the final harness. Over the matched 1,800 simulated seconds it
uses 2.949 process CPU-seconds, compared with 1.666 for the final candidate,
a 43.5% reduction in diagnostic test-process work. These are single matched
diagnostic captures and do not establish normal-server total CPU savings. No
incremental saving is attributed to the small forecast gate.

## Normal-server validation

The normal-server comparison started both variants from a second closed
checkpoint at original checkpoint +200 seconds, immediately before the first
launch at +205 seconds. Its SHA-256 is
`c125b99adc24f302fba3ea93b1c556e1e7d1dc7cabc39906662764452cb03514`.
All 35 cohort items and all 40 loose-item poses remain unchanged. Both CPU
windows span exactly ticks 29201–38201, or 300 simulated seconds, using
server-owned process counters and elapsed wall time. The candidate continued
after that fixed CPU window through all deposits without extending its CPU
comparison. A controlled replay from this derived checkpoint confirmed every
candidate milestone shifts by exactly 200 seconds: first launch at 5, T50 at
257, T90 at 365, T100 at 446, and all deposits at 544 seconds.

The normal-server pair uses identical tick endpoints, zero connected humans,
`GOMEMLIMIT=300MiB`, `GOMAXPROCS=2`, affinity to CPUs 0–1, default `GOGC=100`, and
the same passive telemetry. Both use Go 1.27.1 with the SIMD experiment.

| Normal-server window, ticks 29201–38201 | Baseline | Final candidate |
| --------------------------------------- | -------: | --------------: |
| Simulated seconds                       |      300 |             300 |
| Measured wall seconds                   |  299.967 |         299.968 |
| Go process CPU seconds                  | 1.825020 |        2.096704 |
| CPU as percentage of one core           |   0.608% |          0.699% |
| Cohort items collected at endpoint      |       18 |              25 |
| Cohort items deposited at endpoint      |        9 |               9 |

This is a 14.9% increase in process CPU, or about 0.091 percentage points of one
core, over the fixed early active window. The candidate makes more cleanup
progress during that same interval. One matched pair does not establish a
precise long-run cost difference, and the lower accelerated-replay total cannot
be substituted for a full normal-server CPU comparison. Candidate observation
after this window did not extend or change the CPU measurement.

The final normal server reached these milestones from the original checkpoint:

| Milestone | Exact pickup event | First snapshot confirming held cargo |
| --------- | -----------------: | -----------------------------------: |
| T50       |          456.200 s |                                460 s |
| T90       |          564.367 s |                                565 s |
| T100      |          645.900 s |                                650 s |

All 35 cohort IDs were in station inventories at the 745-second snapshot. At
that point there were zero active collectors, queued trips, in-range loose items,
or missing cohort IDs. Peak active collectors was six. The five original
outside-range items remained loose and were reported separately throughout.

Both capture runners exited successfully and restored affinity. The candidate
watcher then shut down gracefully and preserved the cleaned database at
`benchmarking/_local/collector-cleanup/real-candidate-data/world.sqlite`, with
no WAL and SHA-256
`cfc4c848d8dc2acd02159b0d108d293e764983982bd1b386e5602b9df6dc1e7f`.
The local watchers and frontend were stopped after validation. Live data was not
changed.

## Completion criteria met

The conservative target is a strict 35/35 T100 no later than **900 seconds from
the restored checkpoint**, half the baseline's observed 1,800-second lower bound.
It must also halve active cleanup time from first launch: at most 797.5 seconds
against the baseline's greater-than-1,595-second active lower bound. No finite
baseline T100 is invented to calculate a more favorable percentage.

When including the original 67.967-second disconnect-to-checkpoint prefix in
both totals, a sufficient conservative twofold bound is **866.017 seconds from
the checkpoint**. This distinction must remain explicit in the final result.
The normal server's conservative 650-second held-cargo confirmation meets that
stricter bound. Including the shared disconnect prefix gives 717.967 seconds
against a baseline lower bound of 1,867.967 seconds: more than 2.60 times as fast.
Active cleanup confirmed by snapshot takes 445 seconds against the baseline's
greater-than-1,595-second lower bound: more than 3.58 times as fast. Exact pickup
events are earlier, but these more conservative snapshot bounds already exceed
the twofold goal. No finite baseline completion time is invented.

## Final verification

The complete Go suite and all 126 Node test files pass, including the final
production build. Lint, formatting, and `git diff --check` pass. The gameplay
bundle remains 122.11 kB raw / 51,526 bytes gzip; the ship bundle remains 97.14 kB
raw / 41,379 bytes gzip. Both gzip sizes are unchanged from before this
optimization. No production source edits occurred during the normal-server
measurement pair.
All 51 uninstrumented frozen overlay files were checked against the final
working sources and their hashes match.

The accepted source is frozen in `boundary-throats-overlay-source.tar.gz` with
per-file hashes. The self-contained normal-server source archives are
`real-baseline-overlay-source.tar.gz` (SHA-256
`3d931090fab8347958958458a15dc97d79a313b8fcfbcb3646e69b589a9f1414`)
and `real-throats-overlay-source.tar.gz` (SHA-256
`7ae801ea14351482f5854d904410caaab5432cb66b89e44aaff8ab98897dca6f`).
The normal measurements are `real-baseline.json` and `real-throats.json`, with
separate full telemetry JSONL files. `checkpoint-origin.json` records the common
67.967-second disconnect prefix explicitly.

Raw inputs, source archives, profiles, exact events, and per-second replay
timelines are under `benchmarking/_local/collector-cleanup/`. Reusable commands
and measurement scopes are documented in [benchmarking/README.md](../../benchmarking/README.md).
