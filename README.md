# Unicorn Mining Co

> A web game created for [Js13kGames](https://js13kgames.com/)
> \- the total size of the [zipped](dist/game.zip) [index.html](dist/index.html) is under 13,312B!

### Tech used
- [Kontra.js](https://straker.github.io/kontra/) game engine by [Steven Lambert](https://stevenklambert.com/), rendering to a HTML canvas.
- JavaScript packer [Roadroller](https://lifthrasiir.github.io/roadroller/) by [Kang Seonghoon](https://mearie.org/).
- [JSZip](https://stuk.github.io/jszip/) _and_ [advzip-bin](https://github.com/elliot-nelson/advzip-bin) for zip compression.
- [Vite](https://vitejs.dev/) and [Terser](https://terser.org/) with a messy, unstable, project-specific [custom plugin](plugins/vite-js13k.js) for maximum minification.

### Run locally

1. Clone this repository
   `git clone git@github.com:burntcustard/unicorn-mining-co.git`

2. Install dependencies
  `npm install`

3. Run dev command to start up hot-reloading with [Vite](https://vitejs.dev/) at [localhost:3000](http://localhost:3000/) (you will need to open that URL yourself!)
  `npm run dev`

4. Compile the output [index.html](dist/index.html) file and [game.zip](dist/game.zip) files (this will take a minute or two!)
   `npm run build`

5. See [package.json](package.json) for other scripts
