# Rust server migration

The Rust implementation is available beside the Go server for local validation. Run `npm run build:client` and then `npm run dev:server:rust` from the repository root. The watcher rebuilds the Rust backend when a server file or TypeScript spec changes. The server exposes the built client and existing WebSocket protocol on port 3001. It writes to `.data/world-rust.sqlite` by default and uses the catalog's starting sector for new players. The default npm commands and the active Fly configuration select Go.

`scripts/server-spec-catalog.ts` is the shared projection of the TypeScript specs. The Go generator embeds the JSON as before. Cargo runs the Rust generator at build time and embeds the same JSON and numeric constants. The Rust executable has no Node dependency at runtime.

## Source coverage

| Go source                                  | Rust implementation and verification                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs`, `random`, `utilities`, `vector`   | The generated catalog JSON matched byte for byte. Existing seeded-random, rounding, map-order, and rotation checks cover the numerical primitives.                                                                                                                                                                                                                                                                                                                              |
| `collision`, `physics`, `gameplay`         | Native shape queries, the spatial grid, continuous collision detection, contact caches, and the solver. Existing TypeScript fixtures cover 1,800 physics ticks and several hundred broad-phase operations. Go recordings cover impact and damage order.                                                                                                                                                                                                                         |
| `simulation`, `regions`                    | Sector maps, fields, stations, wrecks, navigation beacons, entity streaming, motion, asteroid subdivision and fracture, and the ordered world tick. The existing TypeScript region, asteroid, and movement fixtures exercise the Rust implementations.                                                                                                                                                                                                                          |
| `objects`                                  | Ship and craft state, module activation, flight, fuel, power, cargo, docking, station trade, hangar ownership, projectile and laser hits, and fracture. Go flight, collider, and fracture recordings cover the mechanics. The Rust hangar tests cover buying, naming, piloting, selling, and retaining the docked berth after selling the last ship.                                                                                                                            |
| `npc`                                      | Navigation, perception, prediction, detached contact forecasts, and pirate, collector, and marauder controllers hosted by the authoritative world. Tests drive pirate launch and dialog, collector controls, and marauder save and restore. Simultaneous collector deadlines use discovery order. Go's map traversal could visit those stations in a different order.                                                                                                           |
| `protocol` and `network`                   | Typed binary controls and snapshots, revision and spatial replication, ordered socket input, snapshot receipts, account and chat policy, telemetry, event sound routing, and multi-sector access and transit. Tests compare TypeScript control packets and nine recorded Go snapshots byte for byte. The session fixture compares the decoded 765 messages from 983 original actions. The sector test travels through a jump gate and reopens SQLite in the destination sector. |
| `persistence`, `main.go`, `maintenance.go` | Native SQLite store, coalesced writer, backups, world and player checkpoints, privileged volume startup, signal shutdown, and private Unix-socket reset, resume, and CPU profiling. A process interruption test restores acknowledged player identity and loadout. The Rust save format has its own schema. Go's pprof parser decoded a profile of the Rust process.                                                                                                            |
| `testtools` and Go integration fixtures    | Native examples replay flight mode, NPC ships, ship destruction, beam visibility, muzzle flashes, projectile prediction, gate collisions, sessions, snapshots, and trade. The original Go tools remain available as reference oracles.                                                                                                                                                                                                                                          |

## Verification

```sh
npm run test:server:rust
cargo test --locked --manifest-path src/server-rust/Cargo.toml
cargo test --locked --manifest-path src/server-rust/Cargo.toml -- --ignored
cargo clippy --locked --manifest-path src/server-rust/Cargo.toml --all-targets -- -D warnings
npm run build
npm run lint
npm test -- --skip-build
```

The ignored Rust tests need permission to bind loopback sockets. The [rust-anything](https://github.com/erkamyaman/rust-anything) 2.0.2 whole-app analyzer inventoried 36 Go units. Its parser reported 59 errors, so source review and the repository's component fixtures supplement the inventory. Eight recorded Go HTTP cases replayed against `examples/http_replay.rs` on an isolated localhost database and asset directory. The HTTP replay covers asset and health responses. Gameplay validation uses the binary WebSocket protocol separately.

`npm run test:server:rust` builds the client, regenerates the TypeScript fixtures, runs the Rust tests, and selects the native server and fixture executables for the existing TypeScript parity and integration cases. Individual startup, recovery, maintenance, and gameplay cases also accept a `TEST_SERVER_EXECUTABLE` path.

## Linux image candidate

```sh
npm run build:client
RUSTFLAGS='-C target-feature=+crt-static' cargo build --locked --release \
  --manifest-path src/server-rust/Cargo.toml --target x86_64-unknown-linux-gnu
install -Dm755 src/server-rust/target/x86_64-unknown-linux-gnu/release/unicorn-mining-server bin/server-rust
docker build --platform linux/amd64 -f src/server-rust/Dockerfile -t unicorn-mining-rust .
```

The image expects a writable volume at `/data`. It uses port 8080, `/healthz`, and a separate database named `world-rust.sqlite`. A local scratch-filesystem test ran the static binary as UID and GID 65532. It checked a production asset, the health endpoint, and a real TypeScript WebSocket session. The active Fly deployment uses the repository's Go Dockerfile.

## Server performance

### Initial port and collision tuning

The Go and Rust runs each started with a fresh, isolated world. They used the standard Vite proxy, CPUs 0–3, a 1 GiB cgroup memory limit, a 15-second warmup, and a 30-second observation window. The reports verify Go's `GOMEMLIMIT=600MiB` and Rust's four Tokio workers. The values below measure the server process as a percentage of one CPU core.

| Four-player workload |    Go | Rust before collision tuning |
| -------------------- | ----: | ---------------------------: |
| Convoy               | 2.03% |                        0.77% |
| Spread               | 2.53% |                        2.00% |
| Contact              | 2.23% |                        2.40% |
| Module and mining    | 2.80% |                        2.00% |
| Weapons              | 1.43% |                        2.70% |

The collision bridge now streams pose capture, uses one staging vector for the collision step, and carries body handles through writeback. This preserves iteration and contact order. A separate Rust weapons profile sampled the simulation, collision bridge, and snapshot capture. The profile ran outside the reported comparison.

| Follow-up workload  |    Go | Tuned Rust |
| ------------------- | ----: | ---------: |
| Four-player contact | 2.43% |      1.53% |
| Four-player weapons | 1.87% |      0.87% |
| 32-player convoy    | 5.80% |      4.47% |

All four-player runs passed the workload and load-generator checks. Some cases on each server missed the separate cadence check. Both weapons reruns passed cadence. In the tuned Rust contact run, all four clients received all 900 snapshots and the longest gap was 103 ms. The Go contact rerun passed cadence.

The first 32-player Rust run used 6.10% of a core. A separate profile highlighted hashing server-assigned physics handles. The rerun after restoring the session fast paths measured 5.10%. The final rerun with faster physics handle lookups measured 4.47%. Both 32-player values in the table passed cadence, workload, and load-generator validation. An additional Rust run used 2.47% and missed cadence, so it is excluded from the table. The other player counts and workloads at 32 players were outside this comparison.

The compressed captures are in `benchmarking/_local/` under `rust-port-go-4p.json.gz`, `rust-port-rust-4p.json.gz`, and the `rust-port-*-contact-rerun.json.gz`, `rust-port-*-weapon-rerun.json.gz`, and `rust-port-*-32p-*.json.gz` files. The diagnostic profiles are `rust-port-weapon-profile.pprof.gz` and `rust-port-32p-convoy-profile.pprof.gz`.

### Relocation and CPU tuning

The Go source lives at `src/server-go` with its original PGO profile mapped to the new package paths. The Rust source lives at `src/server-rust`. The local release uses ThinLTO. Collision processing reuses fixture bounds and dormant asteroid extents, movement reuses validated entity slots, and snapshot encoding reuses observer slots and shared fragments. Station, portal, and sleeping-entity indexes preserve entity order. The socket fast path writes the header and payload together and resumes partial writes from the recorded byte offset.

The matched 32-player comparison used CPUs 4–7 for both servers and CPUs 8–11 for the generators. Both servers ran in 1 GiB cgroups with a 15-second warmup and 30-second measurement. Go used `GOMEMLIMIT=600MiB` and Rust used four Tokio workers. CPU is the server process's percentage of one logical core. The snapshot gap is the largest gap observed by any client after the first five seconds of server uptime.

| Workload | Go CPU | Rust CPU | CPU reduction |  Go gap | Rust gap |
| -------- | -----: | -------: | ------------: | ------: | -------: |
| Convoy   |  7.33% |    4.90% |         33.2% | 51.6 ms |  44.7 ms |
| Spread   |  4.53% |    2.70% |         40.4% | 38.7 ms |  36.6 ms |
| Contact  |  5.19% |    5.09% |          1.9% | 39.6 ms |  39.0 ms |
| Module   |  9.56% |    7.99% |         16.4% | 44.8 ms |  40.9 ms |
| Weapon   | 13.35% |    9.36% |         29.9% | 45.4 ms |  42.2 ms |

All five cases passed workload, cadence, and load-generator checks. This capture used the movement-slot build before packed motion rounding. The raw captures are `benchmarking/_local/rust-move-go-matched-32.json.gz` and `benchmarking/_local/rust-move-rust-matched-32.json.gz`.

The next release packs motion rounding on SSE4.1 hosts with a scalar fallback. Three matched mining repeats at 32 players saved 17.5%, 20.6%, and 22.1% CPU on that build. The largest post-startup snapshot gap fell from 51.2 to 41.5 ms. All six runs passed workload, cadence, and load-generator checks. The captures are `benchmarking/_local/rust-move-go-32-module-repeat.json.gz` and `benchmarking/_local/rust-move-rust-32-module-repeat.json.gz`.

On CPUs 0–3, the packed-rounding build cleared 25% lower CPU in six of the 20 standard cases. All 20 passed cadence with zero skipped ticks. The longest post-startup gap was 42.2 ms for Go and 40.1 ms for Rust. The standard 32-player mining case used 73.3% more Rust CPU, and the separate matched repeats showed lower Rust CPU. Retained captures include both results. The full captures are `benchmarking/_local/rust-move-go-matrix.json.gz` and `benchmarking/_local/rust-move-rust-packed-matrix.json.gz`. The dedicated Go four-player weapon rerun replaces the result interrupted by a Vite restart.

In a separate mining profile on CPUs 12–15, world updates accounted for 52.8% of sampled Rust CPU and snapshot delivery accounted for 30.5%. Collision work accounted for 23.5% of all samples and ran inside world updates. The largest memory copies appeared in movement, where an inline projectile buffer was copied even when empty. The subsequent release passes boxed projectiles directly into the world and reuses the movement-parent buffer. It also reads asteroid segments directly for the existing snapshot revisions and uses a single lookup for existing collision records. The profile is `benchmarking/_local/rust-move-rust-32-module.pprof.gz`.

Five alternating 1,650-tick replays on CPU 12 produced identical hashes of world motion, events, and 6,821,747 encoded snapshot bytes. Median world-update CPU dropped from 777.0 to 599.8 ms, and snapshot CPU dropped from 288.1 to 275.3 ms. The median paired reduction was 17.6% for those components together. The replay measured world updates and encoding in process. The standard workload figures measure the entire server, including its socket connections. The replay data is `benchmarking/_local/rust-move-fixed-replay.json`.

A separate layout experiment boxed the replication record and loose module payload to shrink each entity slot from 376 to 48 bytes. It saved another 4.7% in the fixed replay with matching checksums. Two live-client trials per case showed 1.3% lower median CPU in 32-player mining and 2.9% lower median CPU in eight-player spread, with one regression in each case. Both layout captures are archived under `benchmarking/_local/rust-move-*-layout-*.json.gz`.

The latest 32-player mining pairs on CPUs 4–7 measured Go to Rust process CPU of 9.83% to 7.23%, 27.10% to 7.53%, and 25.89% to 17.09% of one core. The paired reductions were 26.4%, 72.2%, and 34.0%. All six measurements passed workload, cadence, and generator checks. The worst post-startup gap across those pairs fell from 50.9 to 44.9 ms. One Rust attempt stopped at 31 of 32 miners during preparation. A fresh Go and Rust pair supplied the third measurement. Both attempts are in `benchmarking/_local/rust-move-*-latest-mining-*-32-module.json.gz`.

Three latest 16-player mining pairs on CPUs 4–7 saved 28.4%, 20.9%, and 12.7% CPU. The worst gap fell from 49.2 to 39.7 ms. In a separate Rust profiling run, world updates accounted for 50.8% of sampled CPU and snapshot delivery accounted for 34.1%. Collision processing accounted for 27.0% of all samples and ran inside world updates. The Go and Rust captures are `benchmarking/_local/rust-move-*-latest-16-module-16-module.json.gz`, with diagnostic profiles under `benchmarking/_local/rust-move-*-latest-16-module.pprof.gz`.

### Latest full-matrix comparison

Both servers used CPUs 0–3, a 1 GiB cgroup, disposable worlds, four logical server cores, a 15-second warmup, and the standard 30-second measurement. Go used `GOMEMLIMIT=600MiB` and Rust used four Tokio workers. CPU is server-process usage as a percentage of one core. Positive savings mean lower Rust CPU. The maximum snapshot gap excludes the first five seconds of server uptime.

| Players | Workload | Go CPU | Rust CPU | CPU saved | Worst gap Go → Rust |
| ------: | -------- | -----: | -------: | --------: | ------------------: |
|       4 | convoy   |  1.90% |    1.47% |    +22.8% |      36.2 → 35.7 ms |
|       4 | spread   |  1.93% |    1.77% |     +8.6% |      35.4 → 36.8 ms |
|       4 | contact  |  1.93% |    2.03% |     -5.2% |      35.1 → 36.5 ms |
|       4 | module   |  3.90% |    1.87% |    +52.1% |      36.1 → 35.9 ms |
|       4 | weapon   |  2.57% |    1.10% |    +57.1% |      35.2 → 36.4 ms |
|       8 | convoy   |  1.33% |    1.50% |    -12.5% |      37.5 → 35.5 ms |
|       8 | spread   |  1.73% |    1.53% |    +11.5% |      36.6 → 35.3 ms |
|       8 | contact  |  2.17% |    2.13% |     +1.6% |      34.7 → 36.1 ms |
|       8 | module   |  2.76% |    2.00% |    +27.7% |      34.9 → 35.3 ms |
|       8 | weapon   |  3.50% |    2.23% |    +36.1% |      37.5 → 35.9 ms |
|      16 | convoy   |  3.36% |    2.16% |    +35.6% |      36.7 → 35.8 ms |
|      16 | spread   |  4.53% |    3.20% |    +29.4% |      36.6 → 37.0 ms |
|      16 | contact  |  5.69% |    4.20% |    +26.3% |      37.2 → 35.8 ms |
|      16 | module   |  8.26% |    6.83% |    +17.4% |      35.9 → 36.9 ms |
|      16 | weapon   |  6.36% |    4.60% |    +27.7% |      39.6 → 35.9 ms |
|      32 | convoy   |  6.00% |    4.43% |    +26.2% |      42.2 → 37.0 ms |
|      32 | spread   |  4.10% |    6.23% |    -52.0% |      35.1 → 37.0 ms |
|      32 | contact  | 10.47% |    7.96% |    +23.9% |      37.7 → 39.0 ms |
|      32 | module   |  8.72% |   13.26% |    -52.0% |      36.6 → 39.1 ms |
|      32 | weapon   |  4.93% |    8.22% |    -66.9% |      35.4 → 37.1 ms |

All 20 measurements passed workload, load-generator, and cadence checks. Both servers delivered at least 900 snapshots per client per case, with zero shared tick skips. The maximum gap was 42.2 ms for Go and 39.1 ms for Rust. The worst per-client P99 was 35.3 ms for Go and 36.0 ms for Rust.

The table uses a fresh Go four-player weapons run after a Vite restart and fresh Rust runs for eight-player weapons and 32-player mining after preparation timeouts. The original attempts and their replacements are retained. The complete captures are `benchmarking/_local/rust-move-go-matrix.json.gz` and `benchmarking/_local/rust-move-rust-matrix.json.gz`.

The full comparison met the 25% CPU target in nine cases by point estimate. Workload placement and host conditions varied. In 32-player spread and weapons, the unchanged TypeScript load generator also used more than twice as much CPU in the latest matrix as in the earlier runs, with similar snapshot traffic. The figures above use the recorded server-process counters.

Additional matched repeats of the latest build measured these paired median CPU reductions. Cases used the same core affinity and memory settings within each pair.

| Players | Workload | Valid pairs | CPU saved |
| ------: | -------- | ----------: | --------: |
|       4 | convoy   |           3 |     36.0% |
|       4 | spread   |           3 |     31.3% |
|       4 | contact  |           3 |     36.9% |
|       8 | convoy   |           3 |     35.6% |
|       8 | spread   |           3 |     37.1% |
|       8 | contact  |           3 |     40.9% |
|      16 | module   |           3 |     20.9% |
|      32 | convoy   |           3 |     31.9% |
|      32 | spread   |           2 |     35.9% |
|      32 | contact  |           3 |     32.5% |
|      32 | module   |           3 |     34.0% |
|      32 | weapon   |           1 |     42.9% |

Together, the full matrix and matched follow-ups show point estimates of at least 25% lower CPU for 19 of 20 workloads. Sixteen-player mining is the remaining shortfall at a matched median of 20.9%. The standard full-matrix readings show substantial variation, including regressions at 32 players. The largest gap among the four-player convoy repeats was 58.3 ms for Rust and 36.0 ms for Go. All paired measurements in the table passed cadence.

### Four-core CPU and memory investigation

The server restores saved players directly from the SQLite cursor. It allocates prediction slots on first input and releases input and snapshot buffers on disconnect. The saved ships and account state stay in memory. Weapon geometry is retained only while its entity remains resident. Procedural streaming keeps active and pre-generated descriptions and up to 512 recently unloaded descriptions per sector. Older descriptions regenerate from the same seed, with removal records and entity ordering preserved.

The local comparisons used four allowed logical CPUs, disposable disk-backed SQLite data, and no swap. The Go reference used `GOMEMLIMIT=600MiB`, a [soft limit on Go-managed memory](https://go.dev/doc/gc-guide#Memory_limit). The [Fly shared-CPU plan](https://docs.fly.io/machines/cpu-performance/) assigns four shared vCPUs a pooled baseline of 20 ms of CPU every 80 ms, or 25% of one core, plus burst credits. A subset of the Rust runs used that fixed Linux quota with zero burst allowance. The VM configuration specifies 1,024 MiB. The 768 MiB tests modeled leaving 256 MiB outside the server cgroup. [Cgroup memory](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files) includes charged disk cache and kernel memory as well as application memory.

| Synthetic saved world                            | Previous cgroup peak | Current cgroup peak | Previous process RSS high-water | Current process RSS high-water |
| ------------------------------------------------ | -------------------: | ------------------: | ------------------------------: | -----------------------------: |
| Cold boot, 12,000 saved accounts                 |            331.2 MiB |           254.0 MiB |                       283.0 MiB |                      206.6 MiB |
| Cold boot, 32,000 saved accounts                 |            871.8 MiB |           671.4 MiB |                       737.7 MiB |                      533.2 MiB |
| Two 32-player convoys with 12,000 saved accounts |            289.5 MiB |           211.8 MiB |                       291.9 MiB |                      215.2 MiB |

The cold boot tests charged reads of the SQLite file to the scope. The convoy test reused a warm input file and ran the normal 15-second warmup and 30-second measurement. Both convoy builds passed workload and cadence. Their CPU readings were 9.63% and 5.17% of one core before the changes and 10.10% and 5.10% after. The worst post-startup snapshot gap was 46.5 ms before and 53.5 ms after, while the highest per-client P99 dropped from 36.8 to 36.2 ms. The fixed quota caused some throttling during startup and preparation. The measured play windows showed no throttling.

A later build booted the 32,000-account fixture inside 768 MiB with a 671.0 MiB cgroup peak, a 533.3 MiB process RSS high-water, and zero memory-limit or OOM events. The same fixture booted inside a 600 MiB hard limit with similar process RSS. The cgroup recorded 279 limit hits and 1.5 ms of memory pressure while reclaiming file cache. Both cold boots were memory tests without a CPU quota or connected players.

An idle CPU profile of that fixture put 29% of samples in NPC player roster preparation, including 9% comparing names. The server now updates the NPC copy when a player's display name changes. Four alternating runs in 768 MiB cgroups on the same four CPUs used 25.84% and 25.24% of one core before the change and 22.52% and 22.59% after. Median idle CPU fell 11.7%. Charged peaks remained about 671 MiB and process RSS high-water remained about 533 MiB. This fixture had 32,000 saved players and no connected clients.

The bounded region cache reduced anonymous process RSS from 16,292 to 9,984 KiB after visiting 2,500 distinct regions in a separate release replay. Output checksums matched on every route. Three interleaved trials on one pinned core measured 14.0%, 7.7%, and 12.7% lower median wall time for 2-, 48-, and 120-column routes. The 160-column route exceeded the cache capacity and took 25.2% longer than the old unbounded cache, about 2.4 microseconds more per query. The 512-entry cache was 8.5× faster on the 120-column return route than the same cache with 256 entries.

The four-core comparison sampled the authoritative simulation thread at 86–91% of process CPU in the worker-count convoy runs. One, two, and four Tokio workers all passed cadence. The 32-player contact runs under the fixed quota both passed cadence with four and one worker, with charged memory peaks of 12.06 and 11.98 MiB. Raw CPU readings varied with host activity and generator CPU. The server keeps Tokio's automatic worker count.

The fresh-world comparison against Go used the Rust release that preceded these memory changes. The scopes peaked at 94.3 MiB for Go and 48.0 MiB for Rust across preparation and the three workloads below. All cases passed cadence. Both scopes shared the local host, so these single runs describe the workloads and available memory headroom. The earlier matched results remain the basis for the 25% CPU target.

| Workload          | Go CPU | Rust CPU | Go worst post-startup gap | Rust worst post-startup gap |
| ----------------- | -----: | -------: | ------------------------: | --------------------------: |
| 16-player mining  |  8.30% |    5.77% |                  39.04 ms |                    39.18 ms |
| 32-player mining  | 15.86% |   13.16% |                  41.55 ms |                    38.45 ms |
| 32-player weapons | 13.06% |    8.80% |                  39.98 ms |                    37.24 ms |

The first account-memory build ran 32-player contact, mining, and weapons in one 768 MiB scope with a 20 ms per 80 ms quota. Charged memory peaked at 39.2 MiB, with zero limit events or CPU throttles across the scope. Server CPU was 4.33%, 5.53%, and 6.13% of one core. The largest post-startup snapshot gaps were 41.6, 39.4, and 42.2 ms, and all three cases passed cadence.

A separate 32-player contact pair on the same four CPUs and fixed quota compared the releases immediately before and after the NPC name update. CPU was 6.80% and 6.27% of one core. Both passed cadence with zero shared tick skips and zero cgroup CPU throttles. The highest per-client P99 gap was 36.97 and 36.90 ms. The maximum post-startup gap was 53.20 and 65.83 ms. The next-longest client maximum on the final release was 58.74 ms. The worst gap varied across runs while P99 stayed close in this pair.

Two alternating glibc and jemalloc pairs used the same dynamically linked Rust build with four workers and the fixed quota. Jemalloc increased charged memory from 11.11–11.41 MiB to 13.04–13.28 MiB. Raw server CPU was lower with jemalloc, with large concurrent differences in generator CPU and host conditions. Both allocators passed cadence and the measured windows had no throttling. The static release keeps its existing allocator.

The local reports, memory timelines, profiles, and region replay results are archived in `benchmarking/_local/rust-four-core`. The benchmark accepts `--memory-output FILE.jsonl` to label preparation, measurement, and cleanup without changing the workload.

### CPU and snapshot cadence follow-up

The follow-up uses memory headroom to avoid repeated work in the tick and across visits. Release replays compare the same inputs, world state, events, and encoded snapshot bytes. Live-client measurements preserve the standard workload, four-core affinity, 15-second warmup, and 30-second measurement. The snapshot metric is the highest per-client P99 after excluding the first five seconds of server uptime. The fixed-quota comparisons run in 1 GiB cgroups with no swap and 20 ms of CPU available every 80 ms. [Rust Performance Book guidance on profiling](https://nnethercote.github.io/perf-book/profiling.html) and [benchmarking](https://nnethercote.github.io/perf-book/benchmarking.html).

The procedural cache keeps 2,048 recently unloaded descriptions per sector and retains generated navigation beacon candidates, including empty cells. In the release region replay, the 320-column return route used 3.23 seconds of median CPU with the 512-entry cache and 0.32 seconds with the larger cache. The 160-column run went from 0.25 to 0.19 seconds. The 120-column run used 0.12 and 0.13 seconds. All route checksums matched. After visiting 2,500 regions in Patroclus, anonymous RSS rose from 9.7 to 15.1 MiB. Beacon query CPU fell from 0.57 to 0.07 seconds for 1.92 million clustered queries and from 0.66 to 0.07 seconds for the same number of spread queries. Beacon IDs, order, positions, rotations, and spin matched. These timings isolate the region routines from the full server. [Rust Performance Book guidance on caches and allocation reuse](https://nnethercote.github.io/perf-book/general-tips.html).

Filling the original per-sector allowances across 68 sectors used 381 MiB of anonymous RSS in isolation. Giving every sector the full larger allowance raised that to 687 MiB. In the game server, sectors can reserve from a shared allowance of 16,384 additional descriptions above the original 512 per sector, up to 2,048 in any one sector. Loading or dropping a cached description returns its allowance. The shared allowance used 426 MiB in the same 170,000-visit stress replay, with matching generated description counts.

Collision processing reuses exact transformed fixture bounds and retains validated collision body slots. The fixture bounds cost up to 72 bytes per fixture. Two interleaved 3,300-tick replay sets saved 4.7% and 4.9% median world-update CPU with matching world state, events, and 12,746,081 snapshot bytes in each run. [Rust reference on CPU features](https://doc.rust-lang.org/reference/attributes/codegen.html#the-target_feature-attribute).

Snapshot preparation shares up to 128 spatial candidate masks per sector across entity selection and asteroid radar. It shares cadence calculations across observers and reuses asteroid segment captures until damage or fracture changes their contents. Seven interleaved 1,650-tick replays at 32 observers improved median snapshot CPU from 204.429 to 185.899 ms, or 9.1%. Median peak process RSS rose by 316 KiB. All 6,821,747 encoded bytes matched in each run. [Rust Performance Book guidance on allocations](https://nnethercote.github.io/perf-book/heap-allocations.html) and [Rust `Vec` capacity guarantees](https://doc.rust-lang.org/std/vec/struct.Vec.html#capacity-and-reallocation).

On Linux the tick loop uses a one-shot monotonic timerfd. It retains the fixed simulation deadlines and catch-up rules. The Tokio timer is the fallback. A same-binary diagnostic reduced 32-player contact P99 deadline lateness from 1.994 to 0.138 ms and tick-finish interval P99 from 34.787 to 33.853 ms. Worst-client P99 in that test moved from 35.647 to 34.476 ms. Other runs exceeded 35 ms at the client. The usual benchmark observes snapshots after they pass through the Vite proxy, Node WebSocket scheduling, and client decoding. [Tokio timer granularity](https://docs.rs/tokio/latest/tokio/time/fn.sleep_until.html), [Linux timerfd](https://www.man7.org/linux/man-pages/man2/timerfd_create.2.html), and [Node event-loop delay measurement](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions).

Profile-guided optimization was first tested against identical source from the previous release. Four real-client cases trained the profile. Five interleaved 3,300-tick replays reduced median world CPU from 1,122.910 to 1,025.789 ms and median snapshot CPU from 532.179 to 485.682 ms, about 8.7% together. All world and snapshot fingerprints matched. [Rust compiler profile-guided optimization](https://doc.rust-lang.org/rustc/profile-guided-optimization.html) and [LLVM profile merging](https://llvm.org/docs/CommandGuide/llvm-profdata.html).

A separate profile trained the integrated source with the fixed replay and the standard 32-player contact and convoy cases. The matched four-core plain and profile-guided builds used 6.93% and 6.77% of one core for contact and 4.53% and 4.30% for convoy. Worst-client P99 was 36.89 and 37.82 ms for contact, and 35.44 and 35.45 ms for convoy. Both builds passed cadence with zero shared tick skips and zero quota throttles. The profile-guided build is archived as an experimental binary.

The single-thread Tokio diagnostic saved CPU in contact and recorded higher CPU in mining, where the load generator also used more than twice the CPU. The socket-only experiment verified 2.56 million frames and produced a 0.37% median change in sender CPU with one pair favoring each version. The release uses the multi-thread Tokio runtime and the established socket write path. [Tokio scheduler engineering notes](https://tokio.rs/blog/2019-10-scheduler).

The complete targeted round ran every 32-player workload and 16-player mining. CPU is the server process's percentage of one core. P99 is the worst client after the five-second startup exclusion. These preliminary runs shared the host and load-generator cores with other experiments, and generator CPU varied between versions. The valid weapons retry and tuned weapons run both used CPUs 12–15. The other rows both used CPUs 0–3.

| Workload          | Reference CPU | Tuned CPU | Reference P99 | Tuned P99 | Generator CPU, reference to tuned |
| ----------------- | ------------: | --------: | ------------: | --------: | --------------------------------: |
| 32-player convoy  |         2.07% |     1.73% |      35.03 ms |  34.69 ms |                    12.2% to 11.7% |
| 32-player spread  |         5.63% |     6.10% |      36.99 ms |  35.25 ms |                    23.2% to 24.5% |
| 32-player contact |         3.83% |     6.06% |      35.20 ms |  37.82 ms |                    17.9% to 36.8% |
| 32-player mining  |         4.97% |    12.70% |      35.33 ms |  37.41 ms |                    24.4% to 54.2% |
| 32-player weapons |         8.80% |     8.93% |      36.98 ms |  36.48 ms |                    35.4% to 31.4% |
| 16-player mining  |         3.57% |     7.97% |      34.92 ms |  35.33 ms |                    11.9% to 28.0% |

The listed runs passed workload and cadence checks with zero shared tick skips. The first reference weapons attempt lost readiness during warmup and is kept alongside the valid retry. The five-case tuned scope peaked at 46.1 MiB and recorded one quota throttle around the end of 32-player mining. The separate weapons scope peaked at 20.3 MiB with zero quota throttles.

The contact and mining cases were repeated serially after the other benchmark scopes closed. The two versions used the same core sets and standard benchmark timing. Each row is one matched pair.

| 32-player workload | Reference CPU | Tuned CPU | CPU saved | Reference P99 | Tuned P99 | Longest gap, reference to tuned |
| ------------------ | ------------: | --------: | --------: | ------------: | --------: | ------------------------------: |
| Contact            |         6.97% |     6.60% |      5.3% |      36.28 ms |  36.15 ms |               42.91 to 57.90 ms |
| Mining             |        12.06% |    11.70% |      3.0% |      36.85 ms |  36.08 ms |               42.73 to 38.72 ms |

Generator CPU was 39.0% and 38.6% in the contact pair and 53.6% and 55.6% in the mining pair. Both tuned observations passed with zero shared tick skips or quota throttles. Both worst-client P99 measurements remained above the 35 ms target.

The relay diagnostic pinned Vite to CPU 12, the load generator to CPUs 0–3, and the server to CPUs 8–11. Both versions ran the unchanged contact workload with zero shared tick skips and zero quota throttles. The previous and tuned server CPU readings were 7.43% and 7.27% of one core. Worst-client P99 was 39.46 and 42.40 ms. The server's timer trace ends at the send attempt. The client results include the socket write path, proxy forwarding, receiver scheduling, and decoding. Separating the relay and client workers on this host still left client P99 above 35 ms.

Raw benchmark captures, isolated replay sources, profiles, and test logs are in `benchmarking/_local/cpu-priority.1eG3xq`. The local static release is `bin/server-rust`, at 10,999,992 bytes. The native and TypeScript suites, Clippy, lint, the ordinary release build, and a scratch-layout asset and WebSocket check passed.

### Data layout and compiler tuning

Bodies, fixtures, and contacts use reusable indexed slots. Handles retain creation order and reject stale references after a slot is reused. Movement shares station poses across an ordered pass and refreshes them after a station changes. Snapshot selection and module capture borrow records and avoid rebuilding temporary values. Each game object retains only the mass conversion scalar it uses from the flight rules, saving 112 bytes per object. Authoritative positions, rotations, and movement arithmetic retain their existing `f64` precision. [Rust Performance Book guidance on type sizes](https://nnethercote.github.io/perf-book/type-sizes.html).

Across six paired 3,300-tick replays with 32 observers, the updated ordinary release used 21.1% less median paired simulation and snapshot CPU than the previous ordinary release. Median simulation CPU decreased from 872.275 to 662.046 ms, and median snapshot CPU decreased from 365.695 to 313.333 ms. The recorded poses, gameplay events, and all 12,746,081 encoded snapshot bytes matched in every replay.

The default release uses optimization level 3, ThinLTO, one codegen unit, and a portable x86-64 target. Optimization level 2 and x86-64-v3 showed no consistent CPU savings. Full LTO results varied between runs. Four codegen units used 0.96% more median paired replay CPU on the updated source and grew the static binary by 7.8%. Fresh profile-guided optimization saved 11.5% median paired simulation and snapshot CPU against the same source before the mass scalar change. This build used the fixed replay and two standard 32-client workloads for profile training. All five paired replay fingerprints matched. [Cargo release profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) and [rustc profile-guided optimization](https://doc.rust-lang.org/rustc/profile-guided-optimization.html).

The final source received a new profile from the fixed replay and 32-client contact and convoy sessions. Six rotated comparisons measured 12.0% less median paired replay CPU with profile feedback on that source and 29.9% less than the pre-change ordinary release. The replay fingerprints matched across all three builds. The static executable measured 10,514,624 bytes and passed the production-layout asset and WebSocket check.

The connected-client comparison uses four server cores, a 1 GiB memory limit with zero swap, and a fixed quota of 20 ms per 80 ms. The original timing and five-second startup exclusion apply. CPU measures server process user and system time as a percentage of one core. P99 is the highest per-client snapshot gap percentile.

| Workload          | Previous CPU | Updated CPU | CPU saved | Previous P99 | Updated P99 |
| ----------------- | -----------: | ----------: | --------: | -----------: | ----------: |
| 32-player contact |        3.43% |       3.53% |     −2.9% |     34.52 ms |    34.58 ms |
| 32-player mining  |        5.23% |       4.53% |     13.4% |     35.74 ms |    34.33 ms |
| 16-player mining  |        3.57% |       3.07% |     14.0% |     34.12 ms |    34.04 ms |

These single connected-client runs used the updated source before the mass scalar change. Both scopes passed workload and cadence checks without shared tick skips or quota throttling. Peak cgroup memory was 40.0 MiB for the previous release and 36.2 MiB for the updated release. Across these cases the highest client input acknowledgment P99 changed by at most 0.4 ms.

In a same-source contact pair, profile feedback reduced process CPU from 3.50% to 3.17% and the worst-client P99 moved from 35.72 to 35.63 ms. Both reverse-order runs failed the load-generator headroom check. In the separate contact and mining scope, generator CPU rose by 75% and 104% compared with the previous release, respectively. That variation limits attribution of the process measurements to compiler settings.

A repeat of 32-player contact at similar generator load measured 6.80% CPU for the previous release and 6.00% for the final ordinary build, with worst-client P99 of 36.22 and 35.67 ms. Two current-thread Tokio trials used 2.43% and 2.57% CPU against a previous-release run at 3.47% in the lower generator CPU range. The 32-player mining pair on CPUs 12–15 used 17.40% and 15.53% CPU, with similar generator CPU of 57.29% and 57.40%. Its worst-client P99 moved from 37.02 to 36.52 ms, while the longest gap grew from 42.95 to 60.68 ms. The longer mining gap ruled out selecting that runtime for the local release.

The final profile-guided release and the previous release ran the same 32-player mining fixture on CPUs 0–3, with a fresh world before each arm. CPU fell from 12.76% to 11.46% of one core, a 10.2% saving. Generator CPU was 56.47% and 54.24%, respectively. Worst-client P99 fell from 36.84 to 36.48 ms, and the longest gap fell from 43.67 to 42.30 ms. Both measured windows had zero shared tick skips and zero quota throttles. The profile-guided process recorded one throttle during cleanup. Peak charged memory was 34.28 MiB for the previous release and 37.70 MiB for the profile-guided release.

The additional 20% CPU target was verified for the fixed replay. Connected-client tests showed a smaller saving in comparable mining runs. The final profile-guided static release is available locally as `bin/server-rust`. The normal Cargo build uses the portable release settings without requiring a profile.

The raw captures, replay sources, and test logs are in `benchmarking/_local/rust-types.79cbs6`. The compiler results, profile data, and build commands are in `benchmarking/_local/compiler-tuning.2Xevub`.

### Collision, replication, and tick experiments

The previous Rust source and local executable were restored after this round showed mixed results in the closer connected-client comparisons. The measurements below describe the experimental build. Its source, binary, and results are preserved in the benchmark archive.

This round uses the previous profile-guided Rust release as the connected-client reference. Each comparison starts from a fresh local world with seed 25. The standard suite uses the Vite proxy, four pinned server CPUs, a 1 GiB memory limit with zero swap, and 20 ms of CPU every 80 ms. It retains the 15-second warmup, 30-second measurement, and five-second startup exclusion for snapshot gaps.

The ordinary release with the selected changes used 5.94% less combined simulation and snapshot CPU by the median of six paired replays. Median combined time fell from 961.254 to 904.617 ms. In six pairs with profile feedback on both builds, the saving was 5.27% and the median fell from 841.277 to 796.743 ms. Every run matched all 3,300 ticks, 4,628 drill events, 57 asteroid splits, 23,434 collision events, and 12,746,081 encoded snapshot bytes. The replay measures gameplay and encoding CPU before network delivery.

The Rust source adds 454 lines, changes 89, and removes 12, for 531 by the requested calculation. This includes comments and the focused shield expansion regression test.

The full connected-client suites used CPUs 0–3 for the server and 4–7 for the generator. CPU readings below are percentages of one core. The snapshot columns show the highest per-client P99 and longest post-startup gap.

| Workload          | Server CPU before → after | Generator CPU before → after | P99 before → after | Longest gap before → after |
| ----------------- | ------------------------: | ---------------------------: | -----------------: | -------------------------: |
| 32-player convoy  |             1.57% → 2.93% |              11.98% → 24.81% |   34.07 → 36.28 ms |           37.04 → 42.98 ms |
| 32-player spread  |             1.90% → 3.73% |              11.11% → 23.04% |   34.22 → 34.79 ms |           37.06 → 39.24 ms |
| 32-player contact |             3.20% → 5.47% |              17.14% → 41.07% |   34.56 → 36.14 ms |           36.90 → 42.65 ms |
| 32-player mining  |             4.47% → 4.93% |              24.85% → 28.58% |   34.74 → 34.67 ms |           36.77 → 37.46 ms |
| 32-player weapons |             2.50% → 6.06% |              14.57% → 37.48% |   34.26 → 36.14 ms |           37.13 → 42.30 ms |
| 16-player mining  |             2.67% → 6.80% |              12.22% → 31.29% |   33.92 → 36.08 ms |           34.65 → 37.41 ms |

All 12 runs passed workload, cadence, and generator headroom checks with zero shared tick skips. The scopes recorded zero CPU throttles, swap, or memory limit events throughout preparation and measurement. Peak charged memory rose from 42.13 to 44.45 MiB, and peak process RSS rose from 39.80 to 41.95 MiB. The raw average of the six relative server CPU changes was a 93.76% increase. Generator CPU also increased in all six cases by 15–157%, limiting what the spaced-apart runs establish about the source changes. Four of the six updated P99 readings exceeded 35 ms.

Two adjacent fresh-world convoy pairs used the same CPUs and reversed build order in the second pair. With the previous build first, server CPU fell from 3.67% to 3.03% of one core, a 17.28% saving. Generator CPU fell from 27.79% to 26.25%, P99 increased from 35.57 to 35.92 ms, and the longest gap fell from 42.23 to 40.90 ms. With the updated build first, server CPU was 3.50% before and 3.53% after, a 0.95% increase. Generator CPU was 27.02% and 27.51%, P99 was 35.37 and 35.38 ms, and the longest gap was 39.65 and 39.35 ms. All four runs qualified with zero shared tick skips and zero throttles.

Separate 32-player mining runs used server CPUs 8–11 and generator CPUs 12–15. The previous and updated releases used 11.83% and 12.53% of one core with generator CPU of 59.83% and 64.04%. P99 fell from 36.90 to 36.78 ms, and the longest gap fell from 47.94 to 39.64 ms. Both passed and delivered at least 900 snapshots per client with zero shared tick skips. The previous release recorded one 11.35 ms throttle, and the updated release recorded zero. A contact comparison on the same cores measured 6.00% before and 6.07% and 6.23% after with roughly 43% generator CPU in all three cases. The reference narrowly missed the generator's event-loop headroom check. The qualified updated contact run measured 36.50 ms worst-client P99.

| Experiment                                          | CPU result                                                                                                                                                                                                                                                                | Decision                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Cache fixture containment checks                    | Three mixed-replay variants ranged from 0.61% more to 0.20% less CPU                                                                                                                                                                                                      | Dropped                 |
| Revision counters for craft collision shapes        | Two variants saved 2.40% and 2.22% in the mixed replay. The second covered the shield expansion expiry and saved 3.19% of simulation CPU                                                                                                                                  | Kept the second         |
| Sweep parked-body wakes                             | Four mixed-replay variants saved 0.18–0.70%. The best stress variant saved 57% within wake processing for a 600-body vertical strip                                                                                                                                       | Dropped                 |
| Index broad-phase grid entries                      | Three mixed-replay variants saved 0.05–0.84%                                                                                                                                                                                                                              | Dropped                 |
| Update replication cells incrementally              | 3.2% lower combined CPU in the mixed replay. The selection phase used 38–53% less CPU when entities crossed cells. Updating masks in place recovered the initial variant's regression during ordinary play                                                                | Kept                    |
| Reuse encoded cargo and wreckage records            | The combined sidecar saved 2.7% in the ordinary replay and 11.8–14.5% with more cargo and wreckage. The entity layout shrank from 392 to 376 bytes                                                                                                                        | Kept                    |
| Cache drag factors                                  | The per-entity and bounded shared caches used 1.92% and 0.70% more combined CPU                                                                                                                                                                                           | Dropped                 |
| Reuse configured thruster calculations              | The third iteration saved 2.00% over 11 mixed pairs and 1.60% in a longer repeat. The first two saved 0.45% and used 1.07% more CPU, respectively                                                                                                                         | Kept the third          |
| Skip ineligible entities on later movement substeps | Lists and contiguous ranges both cost about 1% in the mixed replay. The ranges cost 0.27% in a sparse replay                                                                                                                                                              | Dropped                 |
| Retain a projectile registry                        | The initial 1.40% saving reversed to 0.39% more CPU on a longer repeat and 1.32% more during sustained fire. Caching the list until membership changed also regressed sustained fire                                                                                      | Dropped                 |
| Decode frequently used binary controls directly     | Two decoders reduced mixed input and receipt CPU from 153.8 to 20.5 and 23.0 ns per message. Measured message rates put the saving near 0.01 percentage points of one core                                                                                                | Dropped                 |
| Skip irrelevant pirate hit and loot handling        | The empty-pirate case with 20 drill events per tick used 421.8 → 0.24 ms over 15,000 ticks in the isolated handler. The event checks preserve the full path when a pirate can react                                                                                       | Kept                    |
| Share hostile NPC geometry within a world phase     | Geometry capture saved 2%, 34%, and 48% with one, four, and 16 observers. This measures the perception stage                                                                                                                                                              | Kept                    |
| Refresh procedural region candidates independently  | Query CPU fell 8%, 46%, and 75% on spread, convoy, and one-moving-observer routes. Sharing lists by rectangle regressed the spread case. The smaller change adds 14 weighted lines and saves about 0.005–0.012 percentage points of one core at the production query rate | Kept the smaller change |
| Recycle input changes                               | Recycling and preparing directly reduced about 57 to 35 ms over 40,000 one-change ticks for 32 players. The estimated production saving was around 0.002 percentage points of one core                                                                                    | Dropped                 |
| Index asteroid fracture sounds                      | Both variants cost CPU with 12 damage events. The two-pass version saved 62% with 256 damage events and accompanying splits. The small-case baseline was 1.18 ms over 18,000 iterations                                                                                   | Dropped                 |
| Reuse persistence buffers and merge writes          | Buffer reuse alone was flat. Reusing JSON writes as well saved 3.42% of paired CPU in a fixture with 150 durable commits. The ordinary save rate leaves a small whole-server gain                                                                                         | Dropped                 |

The Rust seed check now preserves the same generator sequence with less conversion work. Generating 4,096 cold regions took 205.1 ms before and 191.4 ms after by the median. Both versions produced the same 30,168 rocks and region digest. A more specialized modulus fold took 187.8 ms in the same fixture.

Two coordinated Rust and TypeScript prototypes ran in scratch. A shared 32-bit PCG produced identical draws across the two languages and generated those regions in approximately 156.5 ms, with a different digest and only 28,120 rocks. Part of the timing difference comes from generating fewer objects. Grouping the four motion fields with compact widths used 4.25% fewer bytes in the sample packets and slightly more server encoding CPU. Fixed widths saved 17.5 ns per record, used 14.9% more bytes, and projected to about 0.0004 percentage points of one core at the measured record rate. The selected source keeps the existing world generation sequence and wire format.

A four-worker and one-worker Tokio trial used the same updated binary with 32 connected players in contact. The one-worker run reduced server CPU from 6.07% to 5.80% of one core, while the worst-client P99 increased from 36.17 to 36.75 ms and the longest gap increased from 40.71 to 45.26 ms. Both runs narrowly missed the load-generator headroom check. The four-worker default stays in place.

A separate 25-second active mining profile collected 3.05 seconds of CPU samples. World updates accounted for 53.8% of samples, including 24.9% in collisions. Snapshot delivery accounted for 34.4%, including 12.1% in vectored writes. The profile is separate from the CPU and snapshot cadence comparisons.

Six order-balanced loopback repetitions compared two-slice writes with contiguous writes over 32 TCP connections using `TCP_NODELAY`. For paced 50–2,000-byte payloads, contiguous writes saved a median 3.76% of write CPU with a prepared prefix and 5.08% with a copy. Both sometimes cost CPU. Applied to the write share of the mining profile, these savings predict roughly 0.5–0.6% of whole-server CPU before integration costs. All 875,068,920 transmitted bytes matched and the two-slice path stays in place.

Follow-on replication experiments used the selected ordinary release as their reference. Dispatching on the exact kind bytes saved 0.60% of mixed replay CPU. Refreshing live positions and flags in place saved 0.52%. Caching locked asteroid metadata saved 2.23% of snapshot CPU across six confirmation pairs with identical output and added eight bytes per entity. World-update CPU also moved despite the capture-only change. Applying the isolated snapshot saving to the sampled snapshot share predicts about 0.8% of whole-server CPU during mining, so these variants remain in scratch.

A connected 32-player mining comparison added the parked-body sweep to the selected profile-guided build. Server CPU was 12.53% and 11.86% of one core, with 36.78 and 36.68 ms P99 and zero shared tick skips or throttles. Generator CPU also fell from 64.04% to 57.82%. Only eight of the 32 reserved rocks appeared in both cases, and the version with the sweep sent 2.1% fewer snapshot bytes. The mixed fixed replays saved less than 1%. The live measurement leaves the saving from the sweep unresolved, so this version remains in scratch.

The deterministic replay savings are repeatable. The whole-server results leave the 30% CPU target and a consistent P99 below 35 ms unmet. Native Rust tests, 17 TypeScript parity and integration tests, Clippy, lint, and the normal builds passed. Client build asset names and sizes matched. The 10,534,520-byte experimental executable passed the production-layout asset and WebSocket check as UID/GID 65532. The restored `bin/server-rust` is the original 10,514,624-byte reference executable.

Raw scopes, captures, source variants, profiles, and validation logs are in `benchmarking/_local/rust-next.ZggBI5`. The `reference-capture` and `release-capture` files point to the full connected suites. Each `convoy-*-capture` file points to one order-balanced repeat.

### Selective retest of the CPU experiments

Four changes had repeatable wins in the workloads they target. The smaller build combines those changes and reuses the previous Rust release's profile data, compiler settings, and target.

| Change                                | Measured CPU savings                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse encoded cargo and wreckage      | Snapshot CPU fell in all 18 fresh replay pairs. Ordinary snapshot CPU fell 6.52%. Combined simulation and snapshot CPU fell 12.08% and 12.47% with six and twelve cargo entries per ship plus wreckage |
| Track craft collider revisions        | Across 18 exact replay pairs, median simulation CPU fell 2.89% and combined CPU fell 1.61%. Combined CPU fell in 17 pairs. Includes the shield expansion expiry regression test                        |
| Reuse thruster calculations           | Combined replay CPU fell 2.00% across 11 mixed pairs and 1.60% in the longer repeat. The three focused fuel and booster tests passed                                                                   |
| Simplify the seeded RNG integer check | Cold generation CPU fell a median 6.48% over eight pairs of 4,096 regions. All pairs produced the same 30,168 rocks and digest                                                                         |

In nine paired profile-guided replays, the four-change build saved a median 3.67% of combined simulation and snapshot CPU and was faster in every pair. Median combined time was 1,227.304 → 1,182.308 ms. The world hash, gameplay event counts, and all 12,746,081 encoded snapshot bytes matched. Cargo and RNG alone had a flat combined median despite lower snapshot CPU. Thruster and collider changes with RNG saved a median 3.56% across a separate nine-pair replay, winning seven pairs. The four-change source adds 306 lines, changes 62, and removes nine, for 359 by the requested calculation.

Incremental replication cells saved 38–53% in the isolated sparse selection stage with cell crossings. The fresh mixed replay saved only 0.89% overall. The repeated parked-body sweep saved 0.53% combined across both replay campaigns. The spatial, wake, NPC, and region refresh variants remain in the experiment archive.

The connected runs started both versions side by side in separate network namespaces with fresh worlds. Both servers shared CPUs 0–3 with separate 1 GiB and 20 ms per 80 ms scopes. The generators occupied CPUs 4–7 and 8–11, swapping assignments for the second run. Timing stayed at 15 seconds of warmup and 30 seconds of measurement. Comparing the identical previous binary against itself showed 10.42% convoy and 3.37% contact differences in process CPU. Convoy measurement windows overlapped for almost 30 seconds and contact windows overlapped for 19.52–24.47 seconds in the four-change comparisons.

| Workload and repetition     | Process CPU before → after | Worst-client P99 before → after | Longest gap before → after |
| --------------------------- | -------------------------: | ------------------------------: | -------------------------: |
| 32-player convoy, first     |              3.33% → 3.33% |                35.62 → 35.58 ms |           50.97 → 56.63 ms |
| 32-player convoy, switched  |              3.33% → 3.20% |                35.42 → 35.57 ms |           40.06 → 38.03 ms |
| 32-player contact, first    |              3.00% → 2.97% |                34.61 → 34.40 ms |           36.41 → 37.12 ms |
| 32-player contact, switched |              4.67% → 4.67% |                35.83 → 35.93 ms |           39.82 → 40.25 ms |

Both versions passed all four comparisons and delivered at least 900 snapshots per client with zero shared tick skips and zero throttles. The four-change server CPU readings were equal or lower. Savings of 0–4% are within the observed variation. The cargo-and-RNG variant alone showed one lower and one equal convoy CPU reading, with 1.09% and 13.13% higher CPU in contact.

The first mining comparison reported 9.93% server CPU for the previous release and 10.86% for the four-change build. Only 1.20 seconds of the active windows overlapped, and the four-change world recorded 7.1% more assigned asteroid damage observations.

A three-way mining check held each world after normal approach preparation and began the existing 15-second warmup together. The three 30-second measurement windows overlapped for 29.972 seconds. The worlds used the same seed and independent client routes and rock assignments. All three passed the standard mining and headroom checks, delivered at least 900 snapshots per client, and recorded zero shared tick skips and zero throttles.

| 32-player mining build           | Server CPU | Generator CPU | Worst-client P99 | Longest gap | Assigned asteroid damage observations | Peak charged memory |
| -------------------------------- | ---------: | ------------: | ---------------: | ----------: | ------------------------------------: | ------------------: |
| Previous Rust release            |     10.90% |        53.69% |         37.37 ms |    53.24 ms |                                 1,936 |           33.04 MiB |
| Cargo, craft, thrusters, and RNG |     10.16% |        53.39% |         37.10 ms |    49.22 ms |                                 1,997 |           30.44 MiB |
| Craft, thrusters, and RNG        |      9.30% |        50.61% |         36.04 ms |    41.73 ms |                                 2,091 |           34.04 MiB |

The three-change build used 14.68% less CPU than the previous release in this mining check and 8.52% less than the four-change build. Its snapshot payload was 5.53% smaller than the reference and it observed more assigned damage. The single comparison still covers distinct mining scenes. The three-change source has 186 additions, 38 changed lines, and six removals, for 218 by the requested calculation.

The three-change build then ran 32-player convoy and contact side by side with the previous release. Convoy server CPU was 2.80% → 2.73% of one core, and worst-client P99 was 35.53 → 35.14 ms. Contact CPU was 5.83% → 5.80% and P99 was 36.07 → 36.33 ms. Both comparisons delivered at least 900 snapshots per client, with zero shared tick skips or CPU throttles. The CPU differences were within the run-to-run variation seen with identical builds.

The local server now includes the craft collider revisions, thruster reuse, and same-sequence RNG simplification. The cargo and wreckage code stays in the experiment archive. The local static executable is 10,455,880 bytes, 58,744 bytes smaller than the reference. The selected build passed 173 native unit tests, five TypeScript parity tests, and the isolated production-layout asset and WebSocket check. The raw captures, diagnostic runner, and build artifacts are in `benchmarking/_local/rust-next.ZggBI5/selective.gHe7jg`.

### Save frequency, snapshot fields, and motion rounding

The three-change local build is the reference for this round. A 25-second profile of the standard 32-player mining workload collected 870 ms of CPU samples. World updates accounted for 46.0% of samples and snapshot delivery for 32.2%. Collisions accounted for 24.1% inside world updates, and vectored writes for 13.8% inside delivery. These estimates describe one CPU profile.

Normal dirty records flush on a 30-second schedule or at 256 pending entities when the tick has time, with a 60-second deadline. Active player and world checkpoint collection starts every 180 seconds. World collection captures up to eight entities per tick across active sectors. Critical account changes use a commit sequence barrier and can flush sooner. A dedicated writer already coalesces queued rows and commits account, entity, and world records in one WAL transaction with `synchronous=FULL`. In WAL mode, this setting syncs every commit. The default auto-checkpoint threshold is 1,000 WAL pages. [SQLite WAL documentation](https://www.sqlite.org/wal.html).

| Persistence experiment                           | Result                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 48 full commits versus 192 quarter-sized commits | Identical final state after reopen in six fresh pairs. Quarter-sized commits raised total writer CPU by 15.28% and elapsed time by 76.99%. Per-commit wall P95 fell from 2.29 to 0.91 ms. The worst observed commit rose from 3.24 to 6.37 ms |
| Reuse the world UPSERT statement                 | 15.57% lower writer CPU with six accounts and 17.98% lower under 32-account churn. The absolute gain was 12–17 µs per commit and below 0.04% of observed server CPU at the busiest recorded save rate                                         |
| Skip exact no-op player updates                  | 12.61% more writer CPU in the small-account case, 2.63% less under churn, and 0.30% more in the checkpoint case                                                                                                                               |
| Reuse JSON and CBOR buffers                      | 5.94% more writer CPU in the small-account case, 0.35% more under churn, and 2.17% less in the checkpoint case                                                                                                                                |
| Reduce coalescing key clones                     | Merge and commit CPU increased 3.19% in the small case and 3.60% under churn. It decreased 1.03% during the forced checkpoint fixture                                                                                                         |

The partition test repeats world metadata in each quarter-sized transaction to write the same final state. Independent quarter commits could expose partial world, entity, and player updates on recovery, while the current whole transaction preserves their atomicity. The 30- and 180-second schedules, critical delivery barriers, and durability settings stay in place. [SQLite transactions](https://www.sqlite.org/lang_transaction.html).

| Simulation or wire experiment                                  |                                                                                             Median combined replay CPU saving |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------: |
| Separate boxed snapshot value and revision slices              |                                                                                                                        −0.02% |
| Store snapshot value and revision arrays in one box            |                                                                                                                        −1.48% |
| Skip materializing fields already covered by a client baseline |                                                                                                                         0.27% |
| Use a mask to skip clearing absent fields                      |                                                                                                                        −0.28% |
| Stream snapshot fields directly to the packet buffer           |                                                                                             0.44% ordinary, 0.53% cargo-heavy |
| Share asteroid radar candidates across observers               |                                                                                             0.31% ordinary, 0.79% cargo-heavy |
| Combine small wire writes                                      |                                                                                           0.69%, with 1.48% less snapshot CPU |
| Cache entity indexes for collision cleanup                     |                                                                                                                        −2.15% |
| Capture projectile sweeps and collision poses in one scan      |                                                                                                                        −0.99% |
| Compute collision wake bounds directly                         |                                                                                                      0.01% long, −0.33% short |
| Put loose modules and their game objects in one allocation     |                                                        0.27% in the confirmation, with Entity shrinking from 392 to 272 bytes |
| Remove the write-only Rust drill flag                          |                                                 0.19% in the confirmation. The client computes its own audio and effect state |
| Remove the unused copied-view cache from the ordered map       |                                                                                            −1.14% over 16 paired-core replays |
| Dispatch SSE motion rounding once per world                    |                                                                                                                         0.78% |
| Dispatch array-based AVX motion rounding once per world        |                                                                                                                         0.95% |
| Round linear and angular motion in place in the AVX loop       | 1.32% initially. The paired-core repeat measured 0.96% over 3,300 ticks and 1.23% over 6,600 ticks, for a 1.11% pooled median |

All replay variants matched their reference gameplay and encoded snapshots. Contiguous writes in a socket microbenchmark saved 116–129 ns per frame. At the observed snapshot rate, that projects to about 0.12 ms CPU per second. The 32-player captures also delivered about 137 snapshot receipts per second. Input frequency ranged from 7.5 messages per second in convoy to 686 in contact. Combining inputs and receipts would add dependence between their delivery times, with little estimated CPU gain.

Fresh profile-guided optimization on the same source used the fixed replay and 32-client convoy and contact traffic. The build removed 20 control-flow profile mismatches. Across six pairs on each of two CPUs, median combined CPU savings were 0.41% and 0.06%, or 0.21% across all 12 pairs. World CPU fell on both cores while snapshot CPU rose. All hashes matched. Contact passed workload and cadence checks but exceeded the two-core generator's event-loop headroom during training, so that run supplies only compiler input. [Rust compiler PGO documentation](https://doc.rust-lang.org/rustc/profile-guided-optimization.html).

The rounding build uses one AVX feature check for the world loop on supported x86-64 CPUs. Each pass rounds four linear coordinates and then rotation and spin on the existing binary grid. The old path handles other CPUs. A native edge test agrees with the scalar implementation for half ties, signed zero, and non-finite values. Existing TypeScript parity tests passed. [Rust's runtime feature detection](https://doc.rust-lang.org/std/macro.is_x86_feature_detected.html).

The crossed connected pairs used separate 1 GiB cgroups with 20 ms of CPU every 80 ms, shared the same four server CPUs, and switched generator affinities between CPUs 4–7 and 12–15. Both builds passed each case with at least 900 snapshots per client, zero shared tick skips, and zero throttles.

| 32-player case    | Server CPU before → after | Worst-client P99 before → after | Longest gap before → after |
| ----------------- | ------------------------: | ------------------------------: | -------------------------: |
| Convoy, first     |             1.57% → 1.60% |                34.15 → 34.19 ms |           36.57 → 37.06 ms |
| Convoy, switched  |             2.50% → 2.50% |                35.20 → 35.04 ms |           43.32 → 38.89 ms |
| Contact, first    |             3.13% → 3.07% |                34.23 → 34.62 ms |           37.02 → 36.82 ms |
| Contact, switched |             5.53% → 5.30% |                36.29 → 36.60 ms |           43.47 → 43.25 ms |

The convoy differences were within 10 ms of total CPU time over 30 seconds. The contact comparisons observed 2.13% and 4.22% less CPU, with P99 differences below 0.4 ms.

An ordinary release without profile feedback saved 0.52% combined CPU across eight paired replays with exact output. The profile-guided replay is the build configuration that cleared 1%.

The synchronized 32-player mining check used separate generators on CPUs 4–7 and 8–11 and the same four server CPUs. All of the 30-second active windows overlapped. Server CPU fell from 10.30% to 9.83% of one core, or 4.53% in this pair. Generator CPU was 55.17% and 56.19%. P99 was 36.48 and 36.52 ms, and the longest gap fell from 42.98 to 40.37 ms. Both runs passed with zero shared tick skips and zero throttles. Peak charged memory was 30.57 and 30.33 MiB. The candidate world recorded 2,096 assigned asteroid damage observations compared with 1,883 in the reference and sent more snapshot data. These are different mining scenes within the same workload.

Only AVX world rounding was retained. The change adds 101 lines and changes one, including the targeted test. The 10,460,144-byte local executable grew by 4,264 bytes and passed the production-layout asset and WebSocket check. Native Rust unit tests and five TypeScript parity tests passed. The client continues to use the same motion grid and snapshot format.

The profiles, connected captures, and paired replay logs are in `benchmarking/_local/rust-saves.QIPeCw`. Persistence captures are in `benchmarking/_local/persistence-audit.7y4toK`. The socket, simulation, and fresh-profile experiments are in the prior archive under `replica/joint`, `collision/round-two`, and `replica/fresh-pgo`.

### Mining, weapons, and snapshot gaps

The follow-up used fresh disposable worlds, the standard 15-second warmup and 30-second active window, and the existing five-second startup exclusion. The workload CPU figures are process percentages of one core. The main runs used four server CPUs and 1 GiB memory scopes. Go used `GOMEMLIMIT=600MiB`, and Rust used four Tokio workers. The data retains generator affinity, CPU time, and payload volume because the room assignments and scheduling differed between repeats.

| Workload | Go CPU | Existing Rust CPU | Go P99 / longest | Existing Rust P99 / longest |
| --- | ---: | ---: | ---: | ---: |
| 8 mining | 3.03% | 1.33% | 34.51 / 36.14 ms | 33.88 / 35.88 ms |
| 32 mining | 7.87% | 4.20% | 35.44 / 37.83 ms | 36.11 / 38.33 ms |
| 8 convoy | 1.43% | 0.73% | 34.26 / 34.71 ms | 33.69 / 34.11 ms |
| 8 spread | 4.70% | 0.93% | 39.15 / 39.66 ms | 33.65 / 46.13 ms |
| 8 contact | 5.27% | 1.27% | 39.06 / 39.35 ms | 33.67 / 35.30 ms |

The 8-player mining comparison sent 4.00 MB for Go and 3.98 MB for Rust. The 32-player measurements sent 18.14 and 17.86 MB and recorded 2,398 and 2,075 assigned asteroid damage observations. The mining comparisons used separate worlds and different generator affinities. Both Rust mining scopes had zero CPU throttles.

The compact movement and drill contact change saved 2.23% in fixed replays and 2.38% in one synchronized 32-player mining pair. The process CPU increase recurred in both 8-player pairs, 1.33% to 1.43% and 1.43% to 1.53%. The latter pair used identical generator affinity and the candidate sent fewer bytes. This change stays in the experiment archive. Body-pair arenas, lazy collision geometry, proxy storage and neighbor caching, shared contact indices, a colliderless projectile path, power-rate shortcuts, and snapshot cadence masks also stay there.

Paired server and client timestamps matched all 28,800 captures per diagnostic. The server recorded no shared skips, catch-ups, or buffered snapshot sends. Gaps exclude the first five seconds of uptime.

| Rust diagnostic | Server send P99 / longest | Client P99 / longest |
| --- | ---: | ---: |
| 32 spread via Vite | 33.62 / 33.94 ms | 35.67 / 39.96 ms |
| 32 contact via direct WebSocket | 33.79 / 33.88 ms | 35.73 / 40.00 ms |
| 32 mining via Vite | 34.10 / 35.14 ms | 37.09 / 40.67 ms |

The longest client gap in each trace accumulated 6.58 to 7.78 ms after the socket write and before the callback began. The spikes clustered among clients sharing a Node worker. The direct run produced the same pattern. Mining had one server send interval over 35 ms affecting all 32 clients, associated with a 2.005 ms late scheduler wake while the simulation work for that tick took less time than on the previous tick.

The Go and Rust comparisons, alternate source snapshots, and build and test output are in `benchmarking/_local/rust-hot-paths.c1yzHS`. The timestamp joins and raw paths are in `benchmarking/_local/cadence-attribution.k5JcOY`. The mining physics variants are in `benchmarking/_local/mining-pair-arena.01WP1N`.

#### Projectile target index

The 32-player weapons profile attributed 20.0% of sampled CPU to weapon traces, including 9.1% in time of impact. Snapshot delivery accounted for 49.1%. The release indexes target centers and their motion reach once per simulation tick when many projectiles share a world. It checks nearby targets in world insertion order with the existing collision tests. An impact invalidates the index and the remaining projectiles scan live targets. This bounds index construction when many shots hit in the same tick.

Across six order-balanced profile-guided replay pairs per scene, the bounded index saved a median 10.22% of combined simulation and snapshot CPU during sustained four-role weapons fire and 3.75% in a mixed impact-heavy replay. The ordinary release saved 33.66% in the sustained replay. All state, event, and snapshot fingerprints matched. A separate burst replay matched 5,680 projectile hits and all snapshots. The bounded index was 0.82% faster in that replay. The earlier index that rebuilt after impacts was 0.21% slower. The final source adds 313 lines, changes 31, and removes 22, including tests for hit order, reach boundaries, and nonfinite fallback.

| 32-player weapons run | Rust before CPU | Variant CPU | Before P99 / longest | Variant P99 / longest |
| --- | ---: | ---: | ---: | ---: |
| Initial index | 5.07% | 4.97% | 35.67 / 38.29 ms | 36.01 / 44.55 ms |
| Bounded index | 5.60% | 5.23% | 36.18 / 38.58 ms | 35.80 / 38.19 ms |

Both comparisons passed workload and generator checks and had zero skipped ticks or CPU throttles. Each had around 30 seconds of active-window overlap and equal firing cycle counts. The initial index ran on the lower-clock generator group. The eight clients sharing its first Node worker all observed the 44.5 ms spike. The bounded pair used different generator groups with the same maximum frequency. It recorded 6.52% lower process CPU and 8.95% less snapshot traffic in the candidate world. The fixed replays hold workload and output constant. The separate Go run recorded 4.40% CPU, 35.01 ms P99, and a 37.26 ms maximum with 32.63 MB of payload and lower generator CPU.

The new local release is `bin/server-rust` at 10,508,528 bytes, up 48,384 bytes. The ordinary Rust release is 9,664,712 bytes, up 28,496 bytes. Client build names and sizes matched. The native Rust suite, 17 TypeScript checks, Clippy, lint, standard builds, and scratch-layout asset and WebSocket checks passed. The profiling and replay data is in `benchmarking/_local/weapon-scan.zsbQdl`. The local release remains off Fly.io.

A separate trace on the initial index matched all 28,800 sends and receives in a valid 32-player weapons run. The worst-client server-send P99 was 34.03 ms and the longest send gap was 34.27 ms. The client reported 36.24 ms at P99 and a 41.34 ms maximum. At that maximum, server sends were 33.167 ms apart, with another 8.037 ms accruing before the client callback and 0.132 ms in decoding. The socket buffers had no queued bytes at those send samples and all 900 owner ticks advanced once. See `benchmarking/_local/cadence-weapons-sorted.Sfil4r/proxy-weapons-attribution.txt`.

#### Projectile impacts and asteroid colliders

Weapon traces accounted for 27% of sampled simulation CPU in sustained fire and 34% in the repeated-impact replay. The previous bounded target index switched to a live scan after an impact. Instrumentation counted 28,863 fallback projectile traces visiting 24.8 million entities in the 3,300-tick impact replay.

The server now keeps the per-tick index across nonphysical contacts and nonexplosive impacts that preserve target membership and reach. Explosions, removed targets, changed reach, and spawned fragments still cause a live scan for the rest of the phase. Each trace reads current collider geometry. Weapon traces visit asteroid colliders in their existing order as each is constructed, avoiding a temporary collection of all segment colliders. A native test covers a plasma blast pushing another target into the path of the next projectile.

| Fixed 32-player replay | Simulation CPU reduction | Simulation and snapshot CPU reduction |
| --- | ---: | ---: |
| Sustained autogun, plasma, and beam fire | 3.19% | 2.12% |
| Repeated projectile impacts | 16.15% | 12.25% |
| Mixed gameplay | 0.36% | 0.21% |

Each number is the median of six order-balanced paired reductions against the previous bounded-index release, using the same profile-guided build settings. Every pair matched world state, events, encoded snapshot bytes, and their hashes. The repeated-impact fixture matched 5,680 hits, 48 peak active projectiles, and 704 ticks with multiple hits. The index guard alone was faster in all ten impact pairs across the 3,300- and 6,600-tick fixtures. The collider visitor produced another 3.40% combined saving in the final impact comparison against the interim build with the guard and shared rotation cache. Projectile movement specialization, replication buffer pooling, adaptive target sort reuse, and a specialized time-of-impact solver had inconsistent CPU results.

Six paired runs of the ordinary static release also matched every fingerprint. They used 8.94% less combined CPU in repeated impacts and 2.83% less in sustained fire. Sustained-fire CPU varied more across pairs.

The selected static executable ran the standard 32-player weapons workload side by side with the previous Rust release. Each fresh world used seed 25, CPU affinity 0–3, four Tokio workers, a 1 GiB memory limit, and a fixed 20 ms CPU allowance per 80 ms. The 30-second active windows overlapped for 30.004 seconds after the normal 15-second warmup.

| Connected 32-player weapons | Previous Rust | Selected Rust |
| --- | ---: | ---: |
| Server process CPU, percent of one core | 6.33% | 6.10% |
| Server process CPU, percent of four-core capacity | 1.58% | 1.52% |
| Worst-client snapshot P99 | 35.96 ms | 36.46 ms |
| Longest snapshot gap | 50.51 ms | 42.80 ms |
| Snapshot payload | 26.84 MB | 34.87 MB |
| Peak charged memory | 19.27 MiB | 17.58 MiB |

The selected build used 3.66% less process CPU in this pair. Both runs recorded 1,496 autogun and 80 plasma firing cycles, 900 snapshots per client, zero shared tick skips, and zero CPU throttles from startup through measurement. Gap metrics exclude the first five seconds after process startup. The largest gap was 7.71 ms shorter while worst-client P99 was 0.50 ms higher. The candidate world sent 29.94% more snapshot payload. The fixed replays hold output constant and isolate the CPU change.

The local `bin/server-rust` is 10,512,024 bytes, up 3,496 bytes. The ordinary release is 9,669,976 bytes, up 5,264 bytes. Native Rust tests, all 17 TypeScript checks, Clippy, lint, and the production-layout HTTP and WebSocket smoke test passed. Client asset names and sizes matched. The selected replay logs and source checksums are in `benchmarking/_local/projectile-toi.C3YV3L/visit-safe-hit`. The validation logs and `summary.json`, which links to both connected reports, are in `benchmarking/_local/projectile-cpu.Gu8I5K/visitor-connected`.

#### Snapshot membership and radar traffic

The earlier connected weapons pair used the same firing cycle counts and different observer layouts. Final player positions differed by a median of about 1,153 units. The second run had 34.2% more peer ships within the 3,000-unit unload radius and 29.0% more visible autogun projectile identities summed across observers. Two previously isolated clients accounted for 20% of the additional payload. The projectile changes matched every snapshot byte in the fixed replays.

The new snapshot encoding sends removals among already visible entities. Full records carry newly visible entities. Radar updates can replace only the changed slice of the previous position list, with a full list when it is cheaper. Initial loads use the standard representation. The browser opts in through the WebSocket URL and retries the original URL if the first connection fails before opening. The server sends the original representation to legacy sockets.

| Fixed 32-observer replay | Legacy payload | Compact payload | Reduction |
| --- | ---: | ---: | ---: |
| Sustained weapons fire | 14,479,356 B | 13,701,798 B | 5.37% |
| Repeated projectile impacts | 12,641,778 B | 11,953,406 B | 5.45% |
| Mixed gameplay | 14,648,596 B | 11,811,315 B | 19.37% |

All 316,800 frames matched after reconstructing visibility, radar positions, and entity records with the TypeScript decoder. Gameplay state and event digests matched. Legacy packets generated by the updated encoder also matched the previous build byte for byte.

Chromium 157 replayed the same packets using the usual record, radar, and visibility application. Across six paired runs for each scene, main-thread decode and receive-side state CPU fell 5.10% in sustained fire and 5.21% during repeated impacts. Mixed gameplay was effectively flat at 0.56% less CPU. The timings cover packet decode and state application.

Ordinary static releases varied by less than 1% in combined simulation and encoding CPU across six pairs per scene. The profile-guided comparison used 0.92% more CPU in sustained fire, 0.18% more during impacts, and 1.87% more in mixed gameplay. The compiler discarded earlier profile counts for modified functions. Comparing the two wire modes in the same executable put the additional snapshot CPU at 0.21%, 0.12%, and 1.18%, respectively. Alternate observer slot caches, a single-pass radar comparison, and deferred encoding had workload-dependent CPU effects.

| Connected 32-player weapons | Legacy Rust | Compact Rust |
| --- | ---: | ---: |
| Snapshot payload | 33.79 MB | 20.92 MB |
| Server CPU, percent of one core across all threads | 4.63% | 4.50% |
| Server CPU, percent of four-core capacity | 1.16% | 1.12% |
| Worst-client snapshot P99 | 36.33 ms | 36.34 ms |
| Longest snapshot gap | 41.26 ms | 41.45 ms |
| Peak charged memory | 18.51 MiB | 19.93 MiB |

The 30-second windows overlapped for 30.008 seconds. Both seed-25 worlds used the same four CPU affinities, four Tokio workers, and a 1 GiB memory limit with 20 ms of CPU every 80 ms. The benchmark measured 1,496 autogun and 80 plasma cycles and 900 snapshots per client on each server. It recorded zero shared skipped ticks and zero throttles through setup and measurement. This pair showed 2.87% lower server CPU and 38.10% lower payload. The compact run also observed 26.4% fewer autogun projectile identities across clients. The fixed replays provide the controlled estimate of bandwidth savings. Worst-client P99 exceeded 35 ms in both connected runs.

The local static release is 10,583,376 bytes, up 71,352 bytes. The ordinary release is 9,670,192 bytes, up 216 bytes. The gameplay JavaScript grew from 140.17 to 140.73 kB. Legacy format and connection tests, native Rust tests and all 17 Rust-backed TypeScript checks, Clippy, lint, and the static production-layout HTTP and WebSocket smoke tests passed. The raw packets and encoder experiments are in `benchmarking/_local/snapshot-wire.zx31HT`. The connected reports, browser results, validation logs, and independent packet comparison are in `benchmarking/_local/snapshot-traffic.3Evitg`.
