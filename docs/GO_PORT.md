# Go server source port

The Go server directly translates the TypeScript server and simulation methods,
state ownership, object lifetimes, arithmetic, and iteration order. TypeScript
remains the client implementation and the executable reference for parity tests.
Rendering and client-only prediction/reconciliation code are not duplicated in Go.

## Run locally

With Node and Go installed:

```sh
npm run build:go
npm run start:go-server
```

The server listens on port 3001, serves `dist`, `/healthz`, and `/game-socket`.
For client development, run `npm run dev -- --strictPort` alongside the Go server;
Vite's existing WebSocket proxy uses port 3001. The standalone binary is
`bin/go-server`; `PORT`, `WORLD_SEED`, `ASSET_DIR`, and `APP_ENV=production` configure it.
`NODE_ENV=production` also enables production origin checks.

The Docker build uses Node only to build the client and generate the Go catalog.
The final scratch image contains the Go executable and assets. No deployment or
commit is part of this work. Node's server and build command remain available.

## Source layout

Go is server-only. There is no Go shared directory and no second gameplay engine.

| TypeScript source                        | Go source                          |
| ---------------------------------------- | ---------------------------------- |
| `src/server/`                            | `internal/server/`                 |
| `src/shared/collision/`                  | `internal/collision/`              |
| `src/shared/physics/`                    | `internal/physics/`                |
| `src/shared/craft/`                      | `internal/craft/`                  |
| `src/shared/modules/`                    | `internal/modules/`                |
| `src/shared/items/`                      | `internal/items/`                  |
| `src/shared/protocol/`                   | `internal/protocol/`               |
| `src/shared/specification/`              | `internal/specification/`          |
| `src/shared/simulation/`                 | `internal/simulation/`             |
| `src/shared/utilities/`                  | `internal/utilities/`              |
| `src/shared/vector.ts`, `vector-math.ts` | `internal/vector/`                 |
| `src/shared/seeded-random.ts`            | `internal/random/seeded-random.go` |
| `src/server/index.ts`                    | `cmd/go-server/main.go`            |

Collision and physics are siblings; filenames preserve their source basenames.
Go forbids the circular package imports TypeScript permits. The following small
placement exceptions resolve those cycles without changing algorithms:

- `game-object.go`, `geometry.go`, `polygon.go`, and shared mechanics types live
  with World in `simulation`. Entity interfaces supply class-method dispatch.
- `collision/game/game-collisions.go` joins gameplay and physics; primitive
  collision packages cannot import their users. Read-only shape queries live
  in `collision/query/contact-between.go`.
- `create-ship.go` and `create-station.go` live beside their concrete constructors.
- World receives the item constructor registry and collision implementation at
  creation, avoiding reverse imports into the simulation package.
- Ordered maps preserve JavaScript insertion order. The physics contact pool is
  per-world, retains FIFO allocation/release, and has no mutable global pool.

The rejected `internal/game`, alternate solver, reconstructed sessions, obsolete
runners, and old benchmark reports are removed. The external Go Box2D port is
reference material only; see [physics reference](../reference/physics.md).

## Definitions and numerical rules

Typed TypeScript specification objects use `satisfies`; ships name module IDs
such as `hornDrill`. `npm run catalog:go` generates the catalog consumed by Go.
Do not edit `catalog_gen.go` by hand. Server mechanics and client classes consume
these definitions; rendering-only values may remain in the generated catalog
but there is no Go renderer.

`RoundInteger` implements JavaScript's tie-to-positive-infinity and negative-zero
behavior. Position, rotation, spin, and now velocity are rounded to eight decimal
places at the same simulation boundaries in both languages.

Velocity rounding is a deliberate shared physics change made during this port.
Without it, the eight-player module replay had a roughly `1e-12` velocity
variation which selected different speed-limit branches at tick 339. By tick 340
velocity differed by about 1.3 units. Adding the same rounding to both languages
removed that divergence in the 900-tick workload matrix. Velocity is not rounded
inside the contact solver.

Floating-point results are compared with an absolute `2e-8` tolerance, not a
claim of bit-for-bit identity across language runtimes. Near-zero collision
notifications can still differ: the sixteen-player module replay produced extra
Node impacts of roughly `9e-16` to `1e-12`. They have no damage or packet effects;
the client presents collision effects only at impact 40 or above. The benchmark
records these separately as `nearZeroCollisions`; it checks other event counts,
ordered collision events, contacts, state, and decoded packets.

## Runtime ownership

One goroutine owns GameSession and all mutable world state. WebSocket readers
validate and enqueue messages; the writer queue owns socket writes, including
close frames. The owner performs 30 Hz simulation and ordinary snapshots,
catch-up batches, timed-input acknowledgements, region lifecycle, and per-player
delta replication. Each catch-up batch sends one snapshot of its completed state.
Snapshot windows and buffered-byte limits prevent slow receivers from advancing
their baseline or accumulating unbounded state.
Reconnect, duplicate-session replacement, idle expiry, respawn, docking actions,
message limits, heartbeat, health checks, and static assets follow the Node paths.

## Verification

```sh
npm run test:go
npm test
npm run lint
npm run format:check
npm run format:go:check
go test -race ./internal/server
```

`test:go` regenerates recordings by executing the actual TypeScript files, then
checks the Go implementations and decodes Go packets using the TypeScript client
codec. Coverage includes:

- Broad-phase proxy lifecycle and exact callback/iteration order.
- Physics: four bodies for 1,200 steps, eight and sixteen for 300 steps; ordinary
  and swept contacts, circle/polygon geometry, materials, fixture recreation,
  body destruction, manifolds, and contact-list order.
- Forty-five region generation cases across three seeds, cache reuse and copies.
- Twelve asteroid configurations with repeated fractures, release, and events.
- 1,800 movement ticks: observer tiers, parents, decay, burial, and timed inputs.
- Items, cargo pickup rules, integrated flight, convoy, contact, drill, docking,
  shield expansion against cargo, and launches with all four thruster variants.
- Twenty-six HTTP requests recorded from the TypeScript handler.
- Full sessions: 385 decoded packets, timed controls, reconnect, catch-up,
  backpressure, encoded purchases/equipment/paint/repair/selling, and respawn.
- Sixteen simultaneous real WebSocket connections, invalid messages, and shutdown
  under the Go race detector.

`scripts/smoke-go-server.ts` connects to the running Go listener using the real
TypeScript UC encoder and UM decoder; it checks assets, health, welcome, input
acknowledgement, and successive snapshots. Chrome testing of the production
client also passed flight and page-reload reconnect without runtime exceptions.
The development client recorded zero corrections over 250 predicted ticks
(including six seconds of turning flight); reconnect recorded one reconciliation
with zero positional correction. These are local smoke observations, not WAN
latency or Fly measurements.

## Benchmark

```sh
node benchmarking/tools/go-server.mjs
```

Run with Go on PATH. The runner pins both implementations to the same permitted
CPU, uses `GOMAXPROCS=1`, and alternates execution order. Workloads exercise 4, 8,
and 16 players in convoy, spread, contact, and module scenarios with procedural
regions and full per-player binary packet construction. The module workload
replenishes drilling targets every 120 measured ticks. Outputs include CPU per
tick, tick wall-time tails, peak RSS, live heap, contacts, events, and packet bytes.
Compilation, process startup, hello, and 120 warmup ticks precede measurement.
Sockets are in-memory sinks, so these are complete **session CPU** measurements,
not network RTT, WebSocket framing cost, or Fly CPU-quota measurements.

`TICKS`, `REPETITIONS`, `PLAYERS`, and `WORKLOAD` can narrow a diagnostic run.
The default measures 900 ticks per repetition, after a separate traced parity
run for each workload. Peak RSS uses `/proc/self/status` (VmHWM), excluding a
parent process's inherited pre-exec high-water mark. The default writes
`benchmarking/local/go-server.json`. Live deployment and
Fly throttling checks remain for the user's merge/deploy test.

The measured results and limitations are in the
[2026-09-30 benchmark report](../benchmarking/archive/README.md#september-2026).
