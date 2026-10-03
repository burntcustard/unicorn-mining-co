# Regression fixtures

`node --import tsx tests/parity/generate-fixtures.ts` regenerates eight JSON
fixtures from the client implementations. Each module in
`tests/parity/scenarios` exports its computed results; the runner handles file
writing in one process. Go tests compare those results with the server.

| Scenario        | Comparison                                                    |
| --------------- | ------------------------------------------------------------- |
| `asteroids`     | Seeded geometry, contacts, damage, and fracture sequences     |
| `broad-phase`   | Proxy lifecycle, pair/query ordering, and nested queries      |
| `controls`      | Exact binary client controls and server welcome/respawn bytes |
| `gameplay`      | Flight, module activation, collisions, drilling, and docking  |
| `movement`      | Update tiers, local movement, and timed input edges           |
| `physics-world` | Solver motion, contact manifolds, and fixture/body removal    |
| `regions`       | Seeded asteroids, wrecks, stations, and field messages        |
| `rotation`      | Exact rotation-table results, including boundary angles       |

These are computed parity cases, not gameplay definitions. Fixed numbers select
test conditions. Items and HTTP handling use direct tests rather than generated
snapshots. Gameplay instrumentation restores the collision method before the
runner loads another scenario.

`session.json.gz` captures the pre-removal authoritative server's actions and
748 outgoing packets. Parity tests decode and compare Go packets with numeric
tolerance 2e-8; random welcome tokens are normalized. This is independent fixed
regression evidence, not generated from the implementation under test.

`rendering.json` captures representative replicated ship, station, mixed cargo,
and drilling stages. Browser tests hydrate it under source and production
transforms and check rendering, reconciliation and object identity.

Changing game rules or protocol contracts may require deliberate reviewed
updates to fixed fixtures. Do not regenerate expected session packets from Go
merely to make a failed comparison pass.
