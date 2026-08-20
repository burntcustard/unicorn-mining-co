# Unicorn Mining Co

> A web game created for [Js13kGames](https://js13kgames.com/)
> \- the total size of the [zipped](dist/game.zip) [index.html](dist/index.html) is under 13,312B!

## Tech used

- [Kontra.js](https://straker.github.io/kontra/) game engine by [Steven Lambert](https://stevenklambert.com/), rendering to a HTML canvas.
- JavaScript packer [Roadroller](https://lifthrasiir.github.io/roadroller/) by [Kang Seonghoon](https://mearie.org/).
- [JSZip](https://stuk.github.io/jszip/) _and_ [advzip-bin](https://github.com/elliot-nelson/advzip-bin) for zip compression.
- [Vite](https://vitejs.dev/) and [Terser](https://terser.org/) with a messy, unstable, project-specific [custom plugin](plugins/vite-js13k.js) for maximum minification.

## Run locally

1. Clone this repository
   `git clone git@github.com:burntcustard/unicorn-mining-co.git`

2. Install dependencies
  `npm install`

3. Run dev command to start up hot-reloading with [Vite](https://vitejs.dev/) at [localhost:3000](http://localhost:3000/) (you will need to open that URL yourself!)
  `npm run dev`

4. Compile the output [index.html](dist/index.html) file and [game.zip](dist/game.zip) files (this will take a minute or two!)
   `npm run build`

5. See [package.json](package.json) for other scripts

## Build options

| Command | Terser passes | Roadroller | advzip | Use |
| --- | ---: | --- | --- | --- |
| `npm run build:fast` | 1 | Level 0, 4 contexts | Skipped | Quick compilation checks and minor changes |
| `npm run build:slow` | 4 | Level 1, 9 contexts | Default iterations | Size comparisons after larger changes |
| `npm run build:full` | 9 | Level 2, 16 contexts | 1,000 iterations | Release output and the final 13,312-byte check |

`npm run build` runs the full build. Fast and slow ZIPs may exceed 13,312 bytes and are not release artifacts. Roadroller is nondeterministic, so small size differences between builds are normal.
