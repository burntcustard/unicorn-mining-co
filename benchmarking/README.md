# Benchmarks

Build with `npm run build` and run one suite at a time. Local benchmarks use the
normal frontend and Go server on ports 3000/3001. Captures are saved in
`benchmarking/_local/`, including partial results when a run fails.

| Suite                | Command                                                         |
| -------------------- | --------------------------------------------------------------- |
| Rendering            | `npm run benchmark -- --browser chrome`                         |
| Server CPU, local    | `npm run benchmark:server:local -- --cores 2`                   |
| Server CPU, live     | `npm run benchmark:server:live`                                 |
| Input latency, local | `npm run benchmark:latency`                                     |
| Input latency, live  | `npm run benchmark:latency -- --url https://unicorn-mining.co/` |

All suites accept `--output PATH`. Finish builds, tests and profiles before
measuring performance.

## Rendering

One visible browser runs at the monitor's native resolution and pixel density.
Choose `--browser chrome` (default) or `--browser firefox`. A short idle calibration
measures refresh cadence automatically; frame statistics use that measured period.

| Scenario | Workload                                                         |
| -------- | ---------------------------------------------------------------- |
| `live`   | Networked flight with the search light active                    |
| `large`  | Large asteroids, weapons and fractures                           |
| `combat` | Turning and firing among asteroids                               |
| `flight` | Flight and firing through an asteroid corridor                   |
| `pirate` | Three different ships fighting around asteroids using real Go AI |

The default runs all five. Select one with `--scenario pirate`, or pass a
comma-separated list. The suite shares one browser and reuses its page for
isolated worlds; networked cases start a fresh page. Normal graphics, HUD,
audio and the FPS display stay active. Measurement defaults to 30 seconds;
`--seconds N` changes it.
Armed fixtures use one ordinary 200-round ammo item per ship that needs it.

The pirate case uses a local compiler fixture. Prepare it, then start the Go
watcher with the printed overlay setting on its normal port:

```sh
npm run benchmark:pirate:prepare -- /tmp/unicorn-pirate-rendering
GOFLAGS=-overlay=/tmp/unicorn-pirate-rendering/overlay.json npm run dev:server
```

Replace the existing Go watcher for this configuration, keep Vite running, and
restore ordinary `npm run dev:server` afterward.

## Server CPU

The full matrix runs `convoy`, `spread`, `contact`, `module` and `weapon` for
4, then 8, then 16, then 32 lightweight binary-protocol clients.
Convoy follows a common heading, spread cruises through reserved clear corridors,
and contact keeps pairs colliding. Spread reserves corridors outside station
movement areas and checks sustained movement from every ship.

```sh
npm run benchmark:server:local -- --cores 2 --players 16 --workload spread
npm run benchmark:server:live -- --players 8 --workload weapon
```

Start extensive local testing with `npm run reset-world:local` while the Go
watcher is stopped, then restart it before the matrix. Live benchmarks use the
existing world.

`--cores N` limits the local Go process to any supported positive number of
logical CPUs and restores its original affinity afterward. Load clients retain
access to the host's CPUs. `--players` and `--workload` select individual cases.
Defaults are 15 seconds of warmup and 30 seconds of measurement, controlled by
`--warmup` and `--seconds`. Docking and departure operations allow ten minutes;
mining discovery and approach share a ten-minute budget. Ships wait with neutral
controls when ready, then start the measured workload together.

Spread cruises through 1800-unit corridors checked from real snapshots. Captures
allow up to 35 seconds; use `--repetitions N` for longer sampling.

Module ships prefer larger intact asteroids in separate working areas, with
hatches and search lights active. Drilling starts after warmup. Weapon loadouts repeat evenly:
unarmed, plasma accelerator, autogun and beam laser.
Ships buy and equip normally, fly outward for at least ten seconds, settle in
clear space, then fire. Each autogun buys one 200-round item. Weapon warmup is
nonfiring; measurements can run up to 35 seconds on that supply.

Results retain CPU counters and their scope, generator CPU/memory/event-loop
headroom, socket and receipt completion, input acknowledgments and actual work.
Snapshot rate, gaps and skipped ticks describe server cadence separately from
client health. Local results include isolated Go-process CPU and busy CPU on the
selected logical CPUs; Fly machine CPU includes its OS. Compare matching scopes,
core counts and runtime settings, alongside delivered snapshot rates. Match the
deployed `GOGC` and `GOMEMLIMIT` values locally. The Fly configuration specifies
`GOGC=200` and a `300MiB` Go memory budget for its 512 MiB machine.

## Input latency

Four real browser clients share the server: one actor and three observers.
`--scenario steer|fire|both` selects actions; `--trials N` defaults to 100 per
action. Chrome is the default; `--browser firefox` selects Firefox. Temporary
browser contexts receive local-network permission automatically.

The actor uses trusted keyboard input. Reports measure input send, decoded
server acknowledgment and completed local/remote game draws, with per-observer
statistics and paired averages across all three observers. Clock uncertainty,
missed observations and browser health remain in the results. These are game
draw timings. Local and live runs use this checkout's built production client.

## Code

`rendering/`, `server/` and `latency/` own their suites; `utilities/` contains
shared helpers. Benchmark regressions live in `tests/benchmarking/`.
