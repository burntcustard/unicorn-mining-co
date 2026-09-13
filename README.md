# Unicorn Mining Co

> A web game created for [Js13kGames](https://js13kgames.com/) 2026
> \- the total size of the [zipped](dist/game.zip) [index.html](dist/index.html) is (or will be) 13,312B!

## Gameplay

Leave the station by pressing any key, fly around, shine the <ins>L</ins>IGHT into asteroids to search for valuable resources, turn on the <ins>D</INS>RILL to mine those resources out, open the cargo <ins>H</ins>ATCH to scoop them up, and then dock at one of the many stations to sell items, repair your ship, and buy upgrades like thrusters or a <ins>S</ins>HIELD.

There are six rainbow-inspired colors, plus white, that you can color your ship parts with for free. You start with white and violet, but the others you unlock through exploration in the game. There is no death screen (you just have to refresh) or saving (no space, no pun intended, sorry), but if you manage to unlock all 5 of the non-starting colors, then you can consider yourself having complicated the game!

## Gameplay Spoilers

<details>
<summary>World Generation</summary>

Coordinates at the top of the screen are in meters. The whole map is a circle approximately 100,000 meters diameter, with 0,0 in the center.

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
- A [custom fork](https://github.com/burntcustard/roadroller/pull/1) of the JavaScript packer [Roadroller](https://lifthrasiir.github.io/roadroller/) by [Kang Seonghoon](https://mearie.org/).
- [JSZip](https://stuk.github.io/jszip/) _and_ [advzip-bin](https://github.com/elliot-nelson/advzip-bin) for zip compression.
- [Vite](https://vitejs.dev/) and [Terser](https://terser.org/) with a messy, unstable, project-specific [custom plugin](plugins/vite-js13k.js) for maximum minification.

## Run locally

1. Clone this repository
   `git clone git@github.com:burntcustard/unicorn-mining-co.git`

2. Install dependencies
  `npm install`

3. Run dev command to start up hot-reloading with [Vite](https://vitejs.dev/) at [localhost:3000](http://localhost:3000/) (you will need to open that URL yourself!)
  `npm run dev`

4. Compile the output [index.html](dist/index.html) file and [game.zip](dist/game.zip) files (this takes a minute or so)
   `npm run build`

5. See [package.json](package.json) for other scripts

## Build options

| Command | Terser passes | Roadroller | advzip | Use |
| --- | ---: | :---: | --- | --- |
| `npm run build:fast` | 4 | ✅ | 10 iterations | Quick size comparisons for small changes |
| `npm run build:full` | 9 | ✅ | 6,000 iterations | Reproducible release output and the final 13,312-byte check |
| `npm run build:search` | 9 | Search | Skipped | Search forever for optimal Roadroller encoder parameters |

`npm run build` runs the full build. `build:fast` uses 10 advzip
recompression iterations so its size comparisons are quick while still
reflecting real recompression, unlike skipping it entirely. Fast ZIPs may
exceed 13,312 bytes and are not release artifacts. Roadroller always runs
with the same fixed encoder parameters in `build:fast`/`build:full`, so every
build's JS output is deterministic. `build:search` instead builds
`dist/minified.js` the same way as `build:full` and then runs an indefinite
Roadroller CLI search for better encoder parameters (stop it with Ctrl+C when
you've found something worth trying). It preserves Roadroller's normal output
and saves the best reported parameters to `plugins/roadroller-args.js`, which
the normal packer uses on subsequent builds; it does not produce a ZIP.

