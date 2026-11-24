# Unicorn Mining Co

A multiplayer space mining game created for [Js13kGames](https://js13kgames.com/) 2026.
[Play Unicorn Mining Co](https://unicorn-mining.co/).

## Gameplay

Use the search light (**L**) to look into asteroids, the drill (**D**) to break out
minerals, and the cargo hatch (**H**) to collect them. Deploy Plasma Accelerators
with **P** and Autoguns with **A**, then hold **Space** to fire when ready. Dock at
stations to sell cargo, refuel, repair, and buy equipment or a different hull.
Your ship and progress are saved to your browser-linked account.

Explore other sectors through Jump Gates and wormholes. Target a Jump Gate to
request access in the communications panel. Wormholes are open for travel.
Press **Enter** to chat in your sector or switch to the Global tab.

<details>
<summary>Mining and exploration spoilers</summary>

Mixed asteroid fields contain a variety of minerals. Purple amethyst fields and
gold-rich fields concentrate their respective resources. Rare shipwrecks can
contain gems and messages with coordinates for nearby rich fields.

</details>

## Run locally

1. Clone the repository with `git clone git@github.com:burntcustard/unicorn-mining-co.git`.
2. Install Node 26, stable Rust with Cargo, and a C compiler. Run `npm install`.
3. Start the authoritative Rust server with `npm run dev:server` (port 3001).
4. In another terminal, run `npm run dev` and open [localhost:3000](http://localhost:3000/).
   Vite proxies game requests and WebSockets to the server.

To try the production build locally, run `npm run build`, start
`npm run start:server`, and open [localhost:3001](http://localhost:3001/).
`npm run preview` can also serve the built frontend with `start:server` running.

## Development tools

These tools run without the game server. Open the URL Vite prints, starting
at port 3100.

| Tool                 | Command                      |
| -------------------- | ---------------------------- |
| GameObject Viewer    | `npm run tool:object-viewer` |
| Module Viewer        | `npm run tool:module-viewer` |
| World Viewer         | `npm run tool:world-viewer`  |
| Sound Editor         | `npm run tool:sound-editor`  |
| Gemetric Font Viewer | `npm run tool:font-viewer`   |

See the [content-authoring workflow](.agents/skills/codebase-workflow/references/content-authoring.md) for
the object, module, and world viewers, and the [font guide](font/README.md) for glyph editing.

## Build and test

- `npm run build` type-checks and builds the browser assets in `dist/` and the Rust server in `bin/server`.
- `npm test` builds and runs the test suite. Pass a test name or path to select tests.
- `npm run test:server` runs the Rust server and cross-language checks.
- `npm run lint` checks TypeScript, CSS, and Rust. `npm run format:check` checks formatting.

See [package.json](package.json) for all scripts and the
[testing workflow](.agents/skills/codebase-workflow/references/testing.md) for suite options and fixtures.

### Browser tests

Build the game, then use `npm run test:ui` with the local services. See
[browser test setup and options](.agents/skills/codebase-workflow/references/testing.md#browser-tests).

## Source layout

- `src/specs` holds authored game data and tuning shared by the client and Rust server.
- `src/client` contains browser mechanics, prediction, networking, rendering, audio, and UI.
- `src/server` contains the Rust server and its catalog build integration.
- `tests` contains gameplay, network, and client/server parity tests.

The game renders to HTML canvas. The engine draws on
[Kontra.js](https://straker.github.io/kontra/) by [Steven Lambert](https://stevenklambert.com/).
The physics draws on
[Planck.js](https://github.com/piqnt/planck.js), and [Box2D](https://box2d.org/).
The browser build uses [TypeScript](https://www.typescriptlang.org/),
[Vite](https://vitejs.dev/), and [Terser](https://terser.org/). See the
[chunk loading guide](docs/chunk-loading.md) for the 14 KB gzip budget and loading tiers.

## Project skills

- [Codebase workflow](.agents/skills/codebase-workflow/SKILL.md) covers builds, tests, protocol changes, and content authoring.
- [Code style](.agents/skills/code-style/SKILL.md) covers TypeScript, CSS, and formatting conventions.
- [Code terminology](.agents/skills/code-terminology/SKILL.md) covers naming in gameplay and networking code.
- [Code golfing](.agents/skills/code-golfing/SKILL.md) covers reducing production JavaScript and measuring chunk sizes.
- [Sound design](.agents/skills/sound-design/SKILL.md) covers procedural audio, the Sound Editor, and measurement.
- [Fly deployment](.agents/skills/fly-deployment/SKILL.md) covers releases, first-time setup, and live operations.

## Documentation

- [Persistence and world maintenance](docs/persistence.md)
- [Game terminology](docs/terminology.md)
- [Benchmarks](benchmarking/README.md)
- [Todo](docs/todo.md) and [ideas](docs/ideas.md)

## Deploy on Fly.io

Production runs on one Fly Machine in London with a mounted SQLite volume.
Pushes to `main` trigger the [deploy workflow](.github/workflows/deploy.yml).
See the [Fly deployment skill](.agents/skills/fly-deployment/SKILL.md) for
setup and manual releases, and the [persistence guide](docs/persistence.md) for backups and resets.
