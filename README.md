# Unicorn Mining Co

> A web game created for [Js13kGames](https://js13kgames.com/) 2026
> \- delivered as progressively loaded JavaScript resources targeting at most 14 KB gzipped each.

## Gameplay

Leave the station by pressing any key, fly around, shine the <ins>L</ins>IGHT into asteroids to search for valuable resources, turn on the <ins>D</INS>RILL to mine those resources out, open the cargo <ins>H</ins>ATCH to scoop them up, and then dock at one of the many stations to sell items, repair your ship, and buy upgrades like thrusters or a <ins>S</ins>HIELD.

There are six rainbow-inspired colors, plus white, that you can color your ship parts with for free. You start with white and violet, but the others you unlock through exploration in the game. There is no death screen (you just have to refresh) or saving (no space, no pun intended, sorry), but if you manage to unlock all 5 of the non-starting colors, then you can consider yourself having complicated the game!

The world is large, and it's seeded-random, so it's the same for everyone, but the space station you start at is chosen somewhat randomly.

## Spoilers

<details>
<summary>World Generation</summary>

Coordinates at the top of the screen are in meters. The whole map is a circle approximately 100,000 meters diameter, with 0,0 in the center. The is a `world-##.svg` file in this repo that was created with the currently chosen seed, that can be used to find your way around.

Most asteroid fields have a mix of all items, but occasionally you'll find purple pointy amethyst asteroid fields, or asteroid fields with large gold-rich rocks. Ship wrecks can contain a few gems alongside message boxes with coordinates of both of those special asteroid field types - although ship wrecks themselves are quite rare.

</details>

<details>
<summary>Color Unlocks</summary>

RED - Have a hull segment or fitted module destroyed.
ORANGE - Collect an orange slate from an orange shipwreck.
YELLOW - Fly to the edge of the map (50,000 m from the center).
GREEN - Dock at 3 different space stations.
CYAN - Sell a diamond at a space station.
VIOLET - Unlocked by default from the start of the game.
WHITE - Unlocked by default from the start of the game.

</details>

## Tech used

- Game engine heavily inspired by [Kontra.js](https://straker.github.io/kontra/) by [Steven Lambert](https://stevenklambert.com/), rendering to an HTML canvas.
- [Vite](https://vitejs.dev/) and [Terser](https://terser.org/) with a project-specific [custom plugin](plugins/build-plugins.js) for chunking, minification, and size warnings.
- [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) for fast type checking as source files are gradually converted to TypeScript.

## Run locally

1. Clone this repository
   `git clone git@github.com:burntcustard/unicorn-mining-co.git`

2. Install Node 26 and Go 1.27 (with `go` and `gofmt` on PATH), then dependencies
   `npm install`

3. Start the authoritative Go server (rebuilds on Go or definition changes)
   `npm run dev:server`

4. In another terminal, start hot-reloading [Vite](https://vitejs.dev/) at
   [localhost:3000](http://localhost:3000/)
   `npm run dev`

5. Build the browser assets in `dist/` and Go executable in `bin/server`
   `npm run build`

6. To run the production build locally, start `npm run start:server` and open
   [localhost:3001](http://localhost:3001/). It serves the client and WebSocket
   on the same port. `npm run preview` also works with `start:server` running.

Use `dev` with `dev:server`, or the production build with `start:server`.
The same Go server supports source and production clients through binary packets.
Node is used only for frontend builds, generators, and development/test tooling.

7. See [package.json](package.json) for other scripts

`npm run format` formats JavaScript, TypeScript, and other files supported by
Oxfmt. `npm run format:check` checks them without writing changes. These commands
use the npm dependencies and do not require Go.

Format Go source separately with `npm run format:go`, or check it with
`npm run format:go:check`. Both Go commands require `gofmt` on PATH.

## Build

`npm run build` type-checks the client, generates the Go catalog from
`src/definitions`, builds browser ES modules, and compiles `bin/server` with
`GOEXPERIMENT=simd`. `npm run build:client` type-checks and builds browser assets;
`npm run build:server` generates the catalog and compiles Go.
The full build generates the catalog once, during the server build.
The browser build warns when a chunk exceeds 14 KB gzipped; see
[CHUNK_LOADING.md](docs/CHUNK_LOADING.md) for loading tiers.

`npm test` builds once, regenerates mechanics fixtures, and runs all discovered
Node test files and Go tests. Run a single Node test with `npm run test objects`,
`npm run test objects.test.mjs`, or `npm run test tests/client/objects.test.mjs`.
Multiple filenames are supported, and paths disambiguate duplicate filenames.
Selected integration and parity tests prepare their server/catalog and fixtures
automatically; client-only selections skip the full build.
Set `TEST_CONCURRENCY=1` to run the Node tests sequentially. `npm run test:go`
runs Go and parity checks separately; `npm run test:server` checks the Go server
package. `npm run test:packets` checks Go output using both source and
production-mangled client codecs, reporting real WebSocket packet sizes.

## Source layout

- `src/definitions`: typed authored items, modules, ships, stations, and tuning.
- `src/client`: browser mechanics, prediction, networking, rendering, audio, UI.
- `src/server`: Go entry point, objects/modules, simulation, networking, physics.
- `src/server/definitions`: generated catalog and Go decoding types.
- `tests/client`, `tests/integration`, `tests/parity`: retained regression suites.

Each item/ship/station type has one definition file. Generic runtime classes
construct them; thruster variants share one implementation per language.

Gameplay values belong in `src/definitions`: item fallbacks in
`items/defaults.ts`, base-object defaults in `game-object.ts`, shared craft
fallbacks in `craft.ts`, and type-specific values in each content definition.
Client code imports those values; `catalog:go` emits them as Go data or constants.
Edit the TypeScript definitions rather than `catalog_gen.go`.

`scripts/generate-go-catalog.ts` is the build bridge from authored TypeScript
definitions to Go. Test scenarios live in `tests/parity/scenarios`; one runner,
`tests/parity/generate-fixtures.ts`, writes their computed results to
`tests/fixtures` for client/server simulation and protocol comparisons. Scenario
masses, health values, coordinates, seeds, and tick counts are test inputs,
not runtime defaults. Item construction and HTTP handling use direct tests.
Historical reports under `docs/experiments` record the values used by the
measured checkout.

## Documentation

### Current references

- [Client chunk loading and protocol delivery](docs/CHUNK_LOADING.md)
- [Code terminology](docs/terminology.md)
- [Todo](docs/todo.md)
- [Ideas](docs/ideas.md)

### Measurements and history

- [Experiment reports](docs/experiments/README.md): dated investigations and decisions.
- [Benchmark tools and artifacts](benchmarking/README.md): runners, captured results, and reproduction instructions.
- [Older reports and results](benchmarking/archive/README.md): compressed history and extraction instructions.

Current references stay directly under `docs/`. Put new investigation reports in
`docs/experiments/YYYY-MM-DD/` and their evidence in the matching date/topic under
`benchmarking/experiments/`. Historical reports describe the measured checkout;
they are not current configuration instructions.

## Deploy on Fly.io

The public game runs at [unicorn-mining.co](https://unicorn-mining.co/) on one
always-running Fly Machine in London. The authoritative world and players are
in memory: a Machine restart or every push to `main` resets the game. The
`www` hostname redirects to the root domain. There is no database or Fly
volume. Fly's trial stops Machines after five minutes even with `auto_stop_machines = 'off'`; add a payment method before an extended player session ([Fly trial terms](https://fly.io/docs/about/free-trial/)).

1. Install `flyctl` using [Fly's installation guide](https://fly.io/agent-ready.md),
   sign in with `fly auth login`, and run `fly apps list` to check whether the
   app already exists. If `unicorn-mining-co` is unavailable, choose another
   app name and update `fly.toml` before deploying.
2. Create the app with `fly apps create unicorn-mining-co` if it does not
   already exist. This keeps the committed `fly.toml`. Allocate public
   addresses with `fly ips allocate-v4 --shared` and `fly ips allocate-v6`
   (check `fly ips list` first if the app already existed). Deploy with
   `fly deploy --ha=false`, then check `fly status`, `fly logs`, and the
   app's `https://<app>.fly.dev/` URL. Verify that exactly one Machine is
   running and `/healthz` returns `ok`.
3. Create a named, app-scoped deploy token with
   `fly tokens create deploy -a <app> --name github-actions --expiry 2160h`.
   Save it in the GitHub repository's Actions secrets as `FLY_API_TOKEN`;
   rotate it before expiry. The workflow checks the code and automatically
   deploys each push to `main`. Do not put the token in source or `fly.toml`.
4. Attach both hostnames using `fly certs add unicorn-mining.co` and
   `fly certs add www.unicorn-mining.co`. Run `fly certs setup` for each to
   obtain the exact DNS values. In Namecheap's **Advanced DNS**, replace only
   the parking A record for `@` with Fly's A and AAAA addresses, and replace
   the parking `www` record with Fly's CNAME target. Add any ownership or
   ACME verification records that `fly certs setup` requests. Keep the
   existing MX and SPF records used for email forwarding. Use
   `fly certs check` for both hostnames until both certificates are active.
5. Verify HTTPS at the root, the HTTPS redirect from `www`, and a WSS game
   connection from a second network. Update public links and disable the old
   GitHub Pages publication once the Fly site is working. Inspect Fly logs
   and CPU/memory graphs during the first player session.

The production Dockerfile uses Node to build browser assets and generate the
catalog, then compiles Go. The final scratch image contains only `server` and
`dist/`; it has no Node runtime or npm dependencies. The listener binds to
`0.0.0.0:$PORT`; `fly.toml` supplies port 8080, HTTPS, and an HTTP health check.
Its in-memory single-world design requires one Machine.
