# Regression fixtures

`node --import tsx tests/parity/generate-fixtures.ts` regenerates eight JSON
fixtures from the client implementations. Each module in
`tests/parity/scenarios` exports its computed results; the runner handles file
writing in one process. Go tests compare those results with the server.

| Scenario        | Comparison                                                                |
| --------------- | ------------------------------------------------------------------------- |
| `asteroids`     | Seeded geometry, contacts, damage, and fracture sequences                 |
| `broad-phase`   | Proxy lifecycle, pair/query ordering, and nested queries                  |
| `controls`      | Exact binary client controls and server welcome/respawn bytes             |
| `gameplay`      | Flight, module activation, collisions, drilling, and docking              |
| `movement`      | Update tiers, local movement, and timed input edges                       |
| `physics-world` | Solver motion, contact manifolds, and fixture/body removal                |
| `regions`       | Seeded asteroids, wrecks, stations, and field messages                    |
| `rotation`      | Exact wrapped-polynomial results, from subnormal to maximum finite angles |

These are computed parity cases, not gameplay specs. Fixed numbers select
test conditions. Items and HTTP handling use direct tests rather than generated
snapshots. Gameplay instrumentation restores the collision method before the
runner loads another scenario.

Rotation calculations wrap their local input modulo float64 `2*pi` before using
the matching client/server polynomials. The fixture covers both signs, turn and
quadrant boundaries, and large exponents. Direct polynomial tests check accuracy
against native trig at the wrapped angle, unit length, signed zero and nonfinite
inputs. Huge angles intentionally use the float64 remainder as their direction.

`session.json.gz` captures the pre-removal authoritative server's actions and
748 outgoing packets. Parity tests decode and compare Go packets with numeric
tolerance 2e-8; random welcome tokens are normalized. This is independent fixed
regression evidence, not generated from the implementation under test.

The session test reconstructs entity states to compare interest sets independently
of record ordering after reconnect. Welcome and progress messages separately
verify player-owned balances and paint unlocks. Two rejected dock actions now
send corrective loads; these must retain the player's ship state and advance the
snapshot sequence. Those added loads can refresh otherwise stale distant entity
fields, so they do not replace the reconstructed state used for the historical
packet comparisons. The archived packets remain unchanged.

After halving item mass from 6 to 3, socket 4 packet 4 was updated only for
the mass of cargo item 123456. Its encoded float64 changes by one byte;
all other recorded packet bytes and actions remain unchanged.

`rendering.json` captures representative replicated ship, station, mixed cargo,
and drilling stages. Browser tests hydrate it under source and production
transforms and check rendering, reconciliation and object identity.

Changing game rules or protocol contracts may require deliberate reviewed
updates to fixed fixtures. Do not regenerate expected session packets from Go
merely to make a failed comparison pass.

The session comparison reconstructs historical item names from their resource
specs after the `label` to `name` migration. It also adapts the radius of
recorded diamond 123456 to the current diamond points. Generic labels and the
archived packet bytes are preserved.

The historical search light had one beam segment. Its visible housing parts
share the beam's activation state, so the session comparison duplicates that
state for each current model part only in archived one-segment search lights.
Actual packets still have every segment checked; the archived bytes remain
unchanged.

`dom-ui.ts` is the isolated docking scene used by `npm run test:ui`. It loads
through the real DOM docking facade and production property transforms. Purchases,
fitting, repairs and paint use the normal ship actions; the fixture settles sales
locally instead of sending commands for its synthetic ship to the game server.
