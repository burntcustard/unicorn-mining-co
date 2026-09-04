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
you've found something worth trying) — it does not produce a ZIP.
