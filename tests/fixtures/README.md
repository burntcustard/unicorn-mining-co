# Regression fixtures

`node --import ./scripts/register-typescript.ts --import ./tests/support/local-storage.ts tests/parity/generate-fixtures.ts`
regenerates six JSON fixtures from the client implementations. Each module in
`tests/parity/scenarios` exports its computed results; the runner handles file
writing in one process. Rust tests compare those results with the server.

| Scenario        | Comparison                                                                |
| --------------- | ------------------------------------------------------------------------- |
| `asteroids`     | Seeded geometry, contacts, damage, and fracture sequences                 |
| `broad-phase`   | Proxy lifecycle, pair/query ordering, and nested queries                  |
| `controls`      | Exact binary client controls and server welcome/respawn bytes             |
| `movement`      | Update tiers, local movement, and timed input edges                       |
| `physics-world` | Solver motion, contact manifolds, and fixture/body removal                |
| `rotation`      | Exact wrapped-polynomial results, from subnormal to maximum finite angles |

The parity cases use fixed inputs to exercise the client and server implementations.
Item construction and HTTP handling have direct tests.

`npm test -- projectile-prediction` runs one production-transformed replay
against three Rust scenarios: a delayed plasma impact, an autogun fracture
with fragment ID reuse, and a reload partway through mining.

Rotation calculations wrap their local input modulo float64 `2*pi` before using
the matching client/server polynomials. The fixture covers both signs, turn and
quadrant boundaries, and large exponents. Direct polynomial tests check accuracy
against native trig at the wrapped angle, unit length, signed zero and nonfinite
inputs. Huge angles intentionally use the float64 remainder as their direction.

`rendering.json` captures representative replicated ship, station, mixed cargo,
and drilling stages. The rendering test hydrates it with the production transforms and checks
rendering, reconciliation, and object identity.

`dom-ui.ts` is the isolated docking scene used by `npm run test:ui`. It loads
through the real DOM docking facade and production property transforms. Purchases,
fitting, repairs and paint use the normal ship actions; the fixture settles sales
locally instead of sending commands for its synthetic ship to the game server.

`snapshots.json` contains fixed wire packets for byte-for-byte Rust comparisons.
The release server integration test runs the production client decoder against
real load and delta packets.
