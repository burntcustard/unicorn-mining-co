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

2. Install dependencies
   `npm install`

3. Start the authoritative game server
   `npm run dev:server`

4. In another terminal, start hot-reloading [Vite](https://vitejs.dev/) at
   [localhost:3000](http://localhost:3000/)
   `npm run dev`

5. Compile [index.html](dist/index.html) and its JavaScript chunks
   `npm run build`

6. To run the production build locally, start `npm run start:server` and open
   [localhost:3001](http://localhost:3001/). It serves the client and WebSocket
   on the same port. `npm run preview` also works with `start:server` running.

Use `dev` with `dev:server`, or the production build with `start:server`.
Production builds mangle packet fields, so mixing the modes leaves the client
waiting for a welcome packet.

7. See [package.json](package.json) for other scripts

## Build

`npm run build` type-checks and builds the client and server with the same
Terser property names. Both entry points use the shared plugins in
`plugins/build-plugins.js`; `plugins/build-server.js` runs the server bundle. It emits browser-cacheable ES modules, bundles the
production server as `dist/server.js`, and warns if a browser JavaScript chunk
exceeds 14 KB gzipped. See [CHUNK_LOADING.md](docs/CHUNK_LOADING.md) for loading
tiers and their triggers. `npm run test:packets` reports client/server packet
sizes before and after production mangling.

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

The production Dockerfile builds both client and server, then copies only the
built files and the `ws` runtime dependency into the final image. The HTTP
listener binds to `0.0.0.0:$PORT`; `fly.toml` supplies port 8080, HTTPS, and
an HTTP health check. Its in-memory single-world design requires one Machine;
adding another Machine would create a separate world.
