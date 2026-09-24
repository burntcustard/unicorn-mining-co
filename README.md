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
- [Vite](https://vitejs.dev/) and [Terser](https://terser.org/) with a project-specific [custom plugin](plugins/vite-build.js) for chunking, minification, and size warnings.
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

6. To run that production build locally, keep `npm run start:server` running in
   one terminal and serve the build from another
   `npm run preview`

7. See [package.json](package.json) for other scripts

## Build

`npm run build` runs TypeScript 7, builds with nine Terser passes, emits ordinary
browser-cacheable ES modules, and warns if any JavaScript resource is larger
than 14 KB gzipped. See [CHUNK_LOADING.md](docs/CHUNK_LOADING.md) for the current loading
tiers and their triggers.
