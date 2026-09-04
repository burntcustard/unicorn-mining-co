# Build Size Breakdown (`build:full`)

This document provides the byte-level breakdown of all source JavaScript files in `src/` after Vite + Terser minification, along with estimated sizes after Roadroller JS packing in `dist/index.html` and `advzip` DEFLATE compression in `dist/game.zip`.

For the complete methodology, sourcemap VLQ decoding script, and tool inner-workings, see [.agents/skills/build-size-analysis/SKILL.md](.agents/skills/build-size-analysis/SKILL.md).

---

## Build Totals Baseline

* **`dist/minified.js` Total**: 39,602 bytes (39,559 B mapped source code + 43 B bundle wrapper).
* **`dist/index.html` Total**: 18,145 bytes (~45.82% of minified JS size after Roadroller packing & HTML minification).
* **`dist/game.zip` Total**: 13,734 bytes (~34.68% of minified JS size, ~75.69% of HTML size after `advzip` compression).

---

## Source File Breakdown

| File Path | Minified Bytes | % of JS | Est. `dist/index.html` | Est. `dist/game.zip` | Status |
| :--- | :---: | :---: | :---: | :---: | :--- |
| [src/ship.js](src/ship.js) | 5,812 B | 14.68% | 2,663 B | 2,016 B | Included |
| [src/ui/docked.js](src/ui/docked.js) | 4,622 B | 11.67% | 2,118 B | 1,603 B | Included |
| [src/prism.js](src/prism.js) | 3,038 B | 7.67% | 1,392 B | 1,054 B | Included |
| [src/asteroid.js](src/asteroid.js) | 2,737 B | 6.91% | 1,254 B | 949 B | Included |
| [src/collisions.js](src/collisions.js) | 1,973 B | 4.98% | 904 B | 684 B | Included |
| [src/lighting.js](src/lighting.js) | 1,901 B | 4.80% | 871 B | 659 B | Included |
| [src/text.js](src/text.js) | 1,619 B | 4.09% | 742 B | 561 B | Included |
| [src/main.js](src/main.js) | 1,575 B | 3.98% | 722 B | 546 B | Included |
| [src/background.js](src/background.js) | 1,517 B | 3.83% | 695 B | 526 B | Included |
| [src/item.js](src/item.js) | 1,289 B | 3.25% | 591 B | 447 B | Included |
| [src/mining.js](src/mining.js) | 956 B | 2.41% | 438 B | 332 B | Included |
| [src/vector.js](src/vector.js) | 924 B | 2.33% | 423 B | 320 B | Included |
| [src/station.js](src/station.js) | 923 B | 2.33% | 423 B | 320 B | Included |
| [src/world.js](src/world.js) | 907 B | 2.29% | 416 B | 315 B | Included |
| [src/explosion.js](src/explosion.js) | 837 B | 2.11% | 383 B | 290 B | Included |
| [src/ui/controls.js](src/ui/controls.js) | 672 B | 1.70% | 308 B | 233 B | Included |
| [src/resolve.js](src/resolve.js) | 601 B | 1.52% | 275 B | 208 B | Included |
| [src/ui/indicators.js](src/ui/indicators.js) | 599 B | 1.51% | 274 B | 208 B | Included |
| [src/drawing.js](src/drawing.js) | 475 B | 1.20% | 218 B | 165 B | Included |
| [src/sprite.js](src/sprite.js) | 450 B | 1.14% | 206 B | 156 B | Included |
| [src/shrapnel.js](src/shrapnel.js) | 446 B | 1.13% | 204 B | 155 B | Included |
| [src/colors.js](src/colors.js) | 369 B | 0.93% | 169 B | 128 B | Included |
| [src/docking.js](src/docking.js) | 365 B | 0.92% | 167 B | 127 B | Included |
| [src/modules/shield.js](src/modules/shield.js) | 309 B | 0.78% | 142 B | 107 B | Included |
| [src/modules/cargo-scoop.js](src/modules/cargo-scoop.js) | 279 B | 0.70% | 128 B | 97 B | Included |
| [src/polygon.js](src/polygon.js) | 274 B | 0.69% | 126 B | 95 B | Included |
| [src/camera.js](src/camera.js) | 267 B | 0.67% | 122 B | 93 B | Included |
| [src/distribute.js](src/distribute.js) | 260 B | 0.66% | 119 B | 90 B | Included |
| [src/set-sizing.js](src/set-sizing.js) | 260 B | 0.66% | 119 B | 90 B | Included |
| [src/scoop.js](src/scoop.js) | 257 B | 0.65% | 118 B | 89 B | Included |
| [src/modules/horn.js](src/modules/horn.js) | 249 B | 0.63% | 114 B | 86 B | Included |
| [src/game-loop.js](src/game-loop.js) | 246 B | 0.62% | 113 B | 85 B | Included |
| [src/items/message.js](src/items/message.js) | 243 B | 0.61% | 111 B | 84 B | Included |
| [src/local-movement.js](src/local-movement.js) | 207 B | 0.52% | 95 B | 72 B | Included |
| [src/player.js](src/player.js) | 203 B | 0.51% | 93 B | 70 B | Included |
| [src/ui.js](src/ui.js) | 180 B | 0.45% | 82 B | 62 B | Included |
| [src/outline.js](src/outline.js) | 178 B | 0.45% | 82 B | 62 B | Included |
| [src/game.js](src/game.js) | 162 B | 0.41% | 74 B | 56 B | Included |
| [src/modules/floodlight.js](src/modules/floodlight.js) | 159 B | 0.40% | 73 B | 55 B | Included |
| [src/keyboard.js](src/keyboard.js) | 154 B | 0.39% | 71 B | 53 B | Included |
| [src/modules/thruster-triple.js](src/modules/thruster-triple.js) | 134 B | 0.34% | 61 B | 46 B | Included |
| [src/items/explosive.js](src/items/explosive.js) | 119 B | 0.30% | 55 B | 41 B | Included |
| [src/modules/thruster-dual-xl.js](src/modules/thruster-dual-xl.js) | 116 B | 0.29% | 53 B | 40 B | Included |
| [src/modules/thruster-dual-md.js](src/modules/thruster-dual-md.js) | 115 B | 0.29% | 53 B | 40 B | Included |
| [src/items/gold.js](src/items/gold.js) | 101 B | 0.26% | 46 B | 35 B | Included |
| [src/items/diamond.js](src/items/diamond.js) | 91 B | 0.23% | 42 B | 32 B | Included |
| [src/modules/thruster-single-xl.js](src/modules/thruster-single-xl.js) | 87 B | 0.22% | 40 B | 30 B | Included |
| [src/items/amethyst.js](src/items/amethyst.js) | 75 B | 0.19% | 34 B | 26 B | Included |
| [src/flare.js](src/flare.js) | 63 B | 0.16% | 29 B | 22 B | Included |
| [src/items/opal.js](src/items/opal.js) | 59 B | 0.15% | 27 B | 20 B | Included |
| [src/seeded-random.js](src/seeded-random.js) | 51 B | 0.13% | 23 B | 18 B | Included |
| [src/core.js](src/core.js) | 47 B | 0.12% | 22 B | 16 B | Included |
| [src/items/index.js](src/items/index.js) | 7 B | 0.02% | 3 B | 2 B | Included |
| [src/benchmark.js](src/benchmark.js) | 0 B | 0.00% | 0 B | 0 B | Stripped (`DEBUG`/`BENCHMARK` flag) |
| [src/colors-demo.js](src/colors-demo.js) | 0 B | 0.00% | 0 B | 0 B | Stripped (`DEBUG`/`BENCHMARK` flag) |
| [src/fps.js](src/fps.js) | 0 B | 0.00% | 0 B | 0 B | Stripped (`DEBUG`/`BENCHMARK` flag) |
| [src/section-test.js](src/section-test.js) | 0 B | 0.00% | 0 B | 0 B | Stripped (`DEBUG`/`BENCHMARK` flag) |
| [src/text-demo.js](src/text-demo.js) | 0 B | 0.00% | 0 B | 0 B | Stripped (`DEBUG`/`BENCHMARK` flag) |
| [src/craft-render.js](src/craft-render.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/debug.js](src/debug.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/items/cache.js](src/items/cache.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/items/platinum.js](src/items/platinum.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/modules/index.js](src/modules/index.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/modules/thruster-single-md.js](src/modules/thruster-single-md.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/particles.js](src/particles.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/road.js](src/road.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |

---

## Takeaways & Size Insights

1. **Top Files Concentration**:
   * **Top 2 files** (`src/ship.js` + `src/ui/docked.js`) account for **26.35%** of all JavaScript (10,434 minified bytes, ~3,619 bytes in `game.zip`).
   * **Top 5 files** (`src/ship.js`, `src/ui/docked.js`, `src/prism.js`, `src/asteroid.js`, `src/collisions.js`) account for **45.91%** of all JavaScript (18,182 minified bytes, ~6,306 bytes in `game.zip`).
   * **Top 10 files** account for **65.88%** of the total JS payload.

2. **Subfolder Aggregates**:
   * **`src/ui/`**: 5,893 minified bytes (**14.88%** of JS, ~2,044 B in `game.zip`).
   * **`src/modules/`**: 1,521 minified bytes (**3.84%** of JS, ~528 B in `game.zip`).
   * **`src/items/`**: 689 minified bytes (**1.74%** of JS, ~239 B in `game.zip`).

3. **Zero-Byte Files & Dead Code Elimination**:
   * Files wrapped under `// @ifdef DEBUG` or `// @ifdef BENCHMARK` (`src/benchmark.js`, `src/colors-demo.js`, `src/fps.js`, `src/section-test.js`, `src/text-demo.js`) are completely eliminated in `build:full` mode during `viteJs13kPre` pre-processing.
   * Dead source files (`src/craft-render.js`, `src/debug.js`, `src/items/cache.js`, `src/items/platinum.js`, `src/modules/index.js`, `src/modules/thruster-single-md.js`, `src/particles.js`, `src/road.js`) have 0 imports or are fully tree-shaken by Rollup, costing 0 bytes in release builds.
