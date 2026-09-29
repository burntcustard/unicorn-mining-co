# CPU follow-up: binary-only networking and snapshot cadence

This continues [the 29 September CPU methodology](./performance-cpu-methodology-2026-09-29.md), especially its practical target: write fixed-schema binary state directly, then verify client reconstruction against an independent object oracle. The comparison baseline is commit `87ca1c7`, before this follow-up. All changes here stay in the TypeScript server and browser client.

## Method

The CPU measure is process user plus system time per authoritative tick, so V8 and garbage collection work are included. `benchmarking/compare-cpu.mjs` alternates warmed, production-compiled variants on CPUs 2 and 3 with Node 26.5.0, a 16 MiB young-generation semi-space, 1,800 simulation ticks, five repeats, and the convoy, spread, contact and modules routes at 4, 8 and 16 players. The original source bundle is frozen separately from the final source bundle. Physics positions and entity counts must match exactly. Wire hash, bytes and packet count intentionally change with the protocol and cadence. Route medians and paired-repeat ranges are both reported because process CPU varies between runs.

The production flight harness uses stub sockets so it exercises session, world update, replication, packet construction and GC, but not real network transfer or Fly scheduling. Real WebSocket tests cover frame decoding and client reconciliation separately.

## Changes retained

Every production WebSocket frame is binary. `UC` version 1 carries client hello, input, dock actions, respawn and snapshot acknowledgements, plus server welcome and respawn controls. `UM` version 1 carries initial loads and snapshots with numeric field identifiers. There is no old-client negotiation or JSON fallback. The server writes entity records into reusable byte buffers, retains field comparisons across ticks and shares encoded fragments within a snapshot batch. Each observer keeps its own sent revision. The browser decodes the same fixed schema and applies deltas before acknowledging them. Skipped sends leave the observer's baseline unchanged.

The JSON replication implementation remains as an independent test and benchmark oracle. It is outside the production server's import graph. `replication-common.ts` holds the one shared module-state cache and view used by both implementations; the production server bundle has no `JSON.stringify` or `JSON.parse` calls.

Simulation and input remain at 30 Hz. Ordinary state snapshots are sent at 15 Hz, on every second simulation tick, including one send when a catch-up batch crosses a boundary. Hello, load, dock and respawn responses stay immediate. The two-packet acknowledgement window still bounds in-flight state and now supports a roughly 133 ms round trip at full snapshot rate. This halves ordinary snapshot count and avoids preparing/encoding state on skipped ticks.

Other retained CPU edits reuse session input frames and collision-query scratch, reduce craft hitbox allocations, and use direct loops in collision, movement and update scheduling. The purpose is to reduce short-lived garbage, not merely lower retained heap size.

## Intermediate measurements

The fixed-schema binary-only server at 30 Hz improved four-player aggregate CPU by 10.34%, eight-player by 6.25% and sixteen-player by 0.42% against the frozen baseline. For the four-player routes, packet bytes fell from 17,853,316 to 9,216,341, a 48.38% reduction. Object-level comparison against the JSON oracle checked 16,808 reconstructed packets in one four-player modules flight, plus contact and spread flights, with exact state.

Changing only the binary server from 30 Hz to 15 Hz state snapshots produced these independent, same-source aggregate results:

| Players | 30 Hz CPU ms/tick | 15 Hz CPU ms/tick | CPU reduction | Packet-byte reduction |
| ------- | ----------------: | ----------------: | ------------: | --------------------: |
| 4       |          0.666745 |          0.658504 |         1.24% |                34.67% |
| 8       |          1.679989 |          1.550127 |         7.73% |                35.37% |
| 16      |          3.477796 |          3.035856 |        12.71% |                36.82% |

At sixteen players, the individual CPU reductions were 11.50% convoy, 11.11% spread, 5.96% contact and 18.15% modules. Positions and entity counts were exact, while ordinary snapshot count halved. Summed route-median GC collections fell from 484 to 468 at four players, 663.5 to 624 at eight, and 928.5 to 857 at sixteen. GC times were nearly flat at four players (313.8 to 315.2 ms over the full warmed child), and lower at eight (470.9 to 443.3 ms) and sixteen (654.5 to 634.1 ms). These GC durations include warm-up and are not directly additive to the measured-tick CPU table. Peak RSS varies by route and is acceptable for servers with available memory.

The presentation tradeoff is measurable: local predicted ship travel was identical over a ten-second client run, while remote interpolation under jitter or burst delivery gained about 33–36 ms of presentation lag. Steady delivery did not change mean presentation lag. The jitter and burst fixtures had no additional stalled render frames; the outage fixture rose from 57 to 59. The 15 Hz cadence is uniform because it produces the largest CPU win under load and keeps the protocol and scheduling simple.

## Recent-commit simplification and rejected candidates

The last three commits were `87ca1c7` (report only), `d8234c7` and `4e69757`. From their production changes, the `controlShip` boolean array became a bitmask, the lazy asteroid's `uncut` wrapper became direct fields with the same geometry-cache identity, and craft fracture accounting became a `brokenHull` boolean in place of two counts. The hull simplification was the only one benchmarked separately: across eight four-player repeats, its aggregate route-median CPU changed by −0.18% and paired median by +0.45%. Individual routes varied (convoy −4.21%, spread −0.67%, contact −3.01%, modules +4.40%), so the less-than-1% result applies to the aggregate, not every route. The bitmask and asteroid-field changes passed behavior tests and are included in the final whole-server comparison, but no standalone CPU delta can be attributed to either.

Several larger candidates were measured and discarded:

- A persistent collision TOI separation prefilter kept exact outcomes but made four-player contact CPU about 7.7% worse.
- A sixteen-player observer spatial index preserved packets but slowed spread by 1.73% and contact by 5.88%, with more GC. Its per-tick index work exceeded the flat distance scan at these entity counts.
- Direct module capture removed the JSON-shaped module state but gained only 1.14% in sixteen-player modules, about 1.05% in the four-player aggregate, and slowed four-player spread by 4.99%.
- Raising semi-space from 16 to 32 MiB had mixed route outcomes, so the existing 16 MiB setting remains.

The rejected implementations are not in the shared source. The module cache remains because unchanged-state checks cost less than rebuilding maps and segment groups every tick.

## Final direct comparison with the starting server

The final production-flight bundle includes the binary-only protocol, the 15 Hz cadence, the retained allocation reductions and the oracle import cleanup. The [full raw comparison](../benchmarking/results/2026-09-29-cpu-final.json) has five paired repeats per route; it checks exact positions, entity counts and maximum entity counts across variants.

| Players | Baseline CPU ms/tick | Final CPU ms/tick |  Reduction | Paired median (range) |
| ------- | -------------------: | ----------------: | ---------: | --------------------: |
| 4       |             0.738370 |          0.653674 | **11.47%** |  11.77% (8.68–14.20%) |
| 8       |             1.841583 |          1.538031 | **16.48%** | 16.94% (16.38–18.55%) |
| 16      |             3.520293 |          2.945182 | **16.34%** | 15.13% (14.02–20.10%) |

At sixteen players, all four routes improved: convoy 16.38%, spread 12.77%, contact 13.75%, and modules 20.60%. The aggregate is the sum of route medians, with each route weighted equally. This clears the requested additional 10% reduction at every tested player count.

| Players | Baseline → final bytes | Bytes less | Baseline → final GC collections | Baseline → final GC ms |
| ------- | ---------------------: | ---------: | ------------------------------: | ---------------------: |
| 4       |        17.85 → 6.02 MB |     66.28% |                       503 → 468 |          321.2 → 317.0 |
| 8       |       69.61 → 22.69 MB |     67.40% |                       703 → 622 |          493.4 → 483.3 |
| 16      |      163.83 → 51.84 MB |     68.36% |                     1,016 → 859 |          666.1 → 614.8 |

Ordinary packet count is exactly half: 28,800 → 14,400 at four players, 57,600 → 28,800 at eight, and 115,200 → 57,600 at sixteen. The highest route-median peak RSS was 226.8 → 231.2 MiB at four players, 261.8 → 295.1 MiB at eight, and 271.4 → 294.0 MiB at sixteen. Higher retained memory is acceptable here; fewer GC collections and lower process CPU are the goals. GC durations and RSS cover the full warmed child, including setup, whereas CPU ms/tick covers the measured flight.

## Validation and limits

The full `npm test` suite, production build, type-aware lint, formatting check and whitespace check pass. Tests cover the binary-only real WebSocket path, malformed frames, packet bytes, independent JSON state oracle, client prediction, backpressure, reconnects and immediate control responses. A new cadence test checks 30 Hz input application, 15 Hz ordinary snapshots, catch-up batches and immediate hello/dock/respawn messages.

The final direct comparison above clears the target, and a separate 15 Hz modules flight checked 8,408 decoded packet/state comparisons against the JSON object oracle. The remaining large costs are snapshot preparation, collision/physics and GC turnover. A more detailed region-lifecycle/allocation profile would be the next evidence to collect before changing those paths.
