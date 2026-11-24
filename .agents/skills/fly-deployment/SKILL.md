---
name: fly-deployment
description: Deploy Unicorn Mining Co. on Fly.io and maintain the live game, including first-time app setup, release verification, and world operations.
---

# Fly deployment

The live game serves HTTPS and WebSockets on one Machine in `lhr`. Confirm
the target app, Machine count, and attached `game_data` volume with
`fly status` and `fly volumes list`. Keep the existing volume during updates.
Follow the requested release or maintenance scope. Reset the live world only
when explicitly requested.

Use [first-time setup](references/setup.md) when bootstrapping an app, setting
up DNS, or configuring the deploy token. Use the
[persistence guide](../../../docs/persistence.md) for the live database,
backups, resets, and recovery.

## Release

Pushes to `main` trigger the [deployment workflow](../../../.github/workflows/deploy.yml).
It builds statically linked Linux amd64 artifacts once and tests the production
build. Separate jobs check cross-language fixtures, Rust, and standalone
TypeScript. Artifact checksums verify the tested `bin/server` and `dist/` before
deployment. The scratch Docker image packages those artifacts.

For a requested manual release, build and test on Linux amd64:

```sh
SERVER_BUILD_TARGET=x86_64-unknown-linux-gnu RUSTFLAGS="-C target-feature=+crt-static" npm run build
npm test -- --skip-build
fly deploy --ha=false --local-only
```

Use the local Docker daemon for `--local-only`, as CI does.
[Fly deploy flags](https://docs.fly.io/flyctl/cmd/fly_deploy)

Verify the single Machine and volume, check `/healthz` and Fly logs, and load
the game over HTTPS. Check a WSS game connection and, when changing movement
transport, a browser connection over UDP from another network. The game falls
back to its WebSocket when UDP is unreachable.

The HTTP listener binds to `0.0.0.0:$PORT` (8080 in `fly.toml`). The movement
channel uses dedicated public IPv4 and port 8081. The internal and external
UDP ports must match. Check `MOVEMENT_BIND_ADDRESS=fly-global-services:8081`
and the app's IPv4 in `MOVEMENT_PUBLIC_ADDRESS`.
[Fly UDP requirements](https://docs.fly.io/networking/udp-and-tcp)

## Moderate players

Roles are `user`, `admin`, and `owner`. Initial ownership selects the unique
saved profile named `burntcustard`. Once assigned, it follows the private
account ID. Roles and bans survive restarts.

- Admins and owners can use `/admin playername`, `/unadmin playername`,
  `/ban playername`, `/pardon playername`, and `/tp x y`. Names can contain
  spaces and match case-insensitively. Ambiguous matches are rejected.
- The owner is protected from demotion or ban. A ban disconnects the player
  and blocks their ID from reconnecting while retaining progress.
- Any player can use `/list` for a private list of online names. Moderators
  also see each player's sector and coordinates.
