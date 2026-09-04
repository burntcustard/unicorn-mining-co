# Build Size Breakdown (`build:full`)

This document provides the byte-level breakdown of all source JavaScript files in `src/` after Vite + Terser minification, along with estimated sizes after Roadroller JS packing in `dist/index.html` and `advzip` DEFLATE compression in `dist/game.zip`.

For the complete methodology, sourcemap VLQ decoding script, and tool inner-workings, see [.agents/skills/build-size-analysis/SKILL.md](.agents/skills/build-size-analysis/SKILL.md).

---

## Build Totals Baseline

* **`dist/minified.js` Total**: 38,114 bytes (38,071 B mapped source code + 43 B bundle wrapper).
* **`dist/index.html` Total**: 17,618 bytes (~46.22% of minified JS size after Roadroller packing & HTML minification).
* **`dist/game.zip` Total**: 13,319 bytes (~34.94% of minified JS size, ~75.60% of HTML size after `advzip` compression).

---

## Source File Breakdown

| File Path | Minified Bytes | % of JS | Est. `dist/index.html` | Est. `dist/game.zip` | Status |
| :--- | :---: | :---: | :---: | :---: | :--- |
| [src/ship.js](src/ship.js) | 5,812 B | 15.25% | 2,687 B | 2,031 B | Included |
| [src/ui/docked.js](src/ui/docked.js) | 3,134 B | 8.22% | 1,449 B | 1,095 B | Included |
| [src/prism.js](src/prism.js) | 3,038 B | 7.97% | 1,404 B | 1,062 B | Included |
| [src/asteroid.js](src/asteroid.js) | 2,737 B | 7.18% | 1,265 B | 956 B | Included |
| [src/collisions.js](src/collisions.js) | 1,973 B | 5.18% | 912 B | 689 B | Included |
| [src/lighting.js](src/lighting.js) | 1,901 B | 4.99% | 879 B | 664 B | Included |
| [src/text.js](src/text.js) | 1,619 B | 4.25% | 748 B | 566 B | Included |
| [src/main.js](src/main.js) | 1,575 B | 4.13% | 728 B | 550 B | Included |
| [src/background.js](src/background.js) | 1,517 B | 3.98% | 701 B | 530 B | Included |
| [src/item.js](src/item.js) | 1,289 B | 3.38% | 596 B | 450 B | Included |
| [src/mining.js](src/mining.js) | 956 B | 2.51% | 442 B | 334 B | Included |
| [src/vector.js](src/vector.js) | 924 B | 2.42% | 427 B | 323 B | Included |
| [src/station.js](src/station.js) | 923 B | 2.42% | 427 B | 323 B | Included |
| [src/world.js](src/world.js) | 907 B | 2.38% | 419 B | 317 B | Included |
| [src/explosion.js](src/explosion.js) | 837 B | 2.20% | 387 B | 292 B | Included |
| [src/ui/controls.js](src/ui/controls.js) | 672 B | 1.76% | 311 B | 235 B | Included |
| [src/resolve.js](src/resolve.js) | 601 B | 1.58% | 278 B | 210 B | Included |
| [src/ui/indicators.js](src/ui/indicators.js) | 599 B | 1.57% | 277 B | 209 B | Included |
| [src/drawing.js](src/drawing.js) | 475 B | 1.25% | 220 B | 166 B | Included |
| [src/sprite.js](src/sprite.js) | 450 B | 1.18% | 208 B | 157 B | Included |
| [src/shrapnel.js](src/shrapnel.js) | 446 B | 1.17% | 206 B | 156 B | Included |
| [src/colors.js](src/colors.js) | 369 B | 0.97% | 171 B | 129 B | Included |
| [src/docking.js](src/docking.js) | 365 B | 0.96% | 169 B | 128 B | Included |
| [src/modules/shield.js](src/modules/shield.js) | 309 B | 0.81% | 143 B | 108 B | Included |
| [src/modules/cargo-scoop.js](src/modules/cargo-scoop.js) | 279 B | 0.73% | 129 B | 97 B | Included |
| [src/polygon.js](src/polygon.js) | 274 B | 0.72% | 127 B | 96 B | Included |
| [src/camera.js](src/camera.js) | 267 B | 0.70% | 123 B | 93 B | Included |
| [src/distribute.js](src/distribute.js) | 260 B | 0.68% | 120 B | 91 B | Included |
| [src/set-sizing.js](src/set-sizing.js) | 260 B | 0.68% | 120 B | 91 B | Included |
| [src/scoop.js](src/scoop.js) | 257 B | 0.67% | 119 B | 90 B | Included |
| [src/modules/horn.js](src/modules/horn.js) | 249 B | 0.65% | 115 B | 87 B | Included |
| [src/game-loop.js](src/game-loop.js) | 246 B | 0.65% | 114 B | 86 B | Included |
| [src/items/message.js](src/items/message.js) | 243 B | 0.64% | 112 B | 85 B | Included |
| [src/local-movement.js](src/local-movement.js) | 207 B | 0.54% | 96 B | 72 B | Included |
| [src/player.js](src/player.js) | 203 B | 0.53% | 94 B | 71 B | Included |
| [src/ui.js](src/ui.js) | 180 B | 0.47% | 83 B | 63 B | Included |
| [src/outline.js](src/outline.js) | 178 B | 0.47% | 82 B | 62 B | Included |
| [src/game.js](src/game.js) | 162 B | 0.43% | 75 B | 57 B | Included |
| [src/modules/floodlight.js](src/modules/floodlight.js) | 159 B | 0.42% | 73 B | 56 B | Included |
| [src/keyboard.js](src/keyboard.js) | 154 B | 0.40% | 71 B | 54 B | Included |
| [src/modules/thruster-triple.js](src/modules/thruster-triple.js) | 134 B | 0.35% | 62 B | 47 B | Included |
| [src/items/explosive.js](src/items/explosive.js) | 119 B | 0.31% | 55 B | 42 B | Included |
| [src/modules/thruster-dual-xl.js](src/modules/thruster-dual-xl.js) | 116 B | 0.30% | 54 B | 41 B | Included |
| [src/modules/thruster-dual-md.js](src/modules/thruster-dual-md.js) | 115 B | 0.30% | 53 B | 40 B | Included |
| [src/items/gold.js](src/items/gold.js) | 101 B | 0.26% | 47 B | 35 B | Included |
| [src/items/diamond.js](src/items/diamond.js) | 91 B | 0.24% | 42 B | 32 B | Included |
| [src/modules/thruster-single-xl.js](src/modules/thruster-single-xl.js) | 87 B | 0.23% | 40 B | 30 B | Included |
| [src/items/amethyst.js](src/items/amethyst.js) | 75 B | 0.20% | 35 B | 26 B | Included |
| [src/flare.js](src/flare.js) | 63 B | 0.17% | 29 B | 22 B | Included |
| [src/items/opal.js](src/items/opal.js) | 59 B | 0.15% | 27 B | 21 B | Included |
| [src/seeded-random.js](src/seeded-random.js) | 51 B | 0.13% | 24 B | 18 B | Included |
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

## Detailed Component Breakdown: `src/ship.js` (5,812 B total)

Below is the code-chunk level breakdown of [src/ship.js](src/ship.js) (the largest single file in the build, representing 14.68% of minified JS).

| Code Chunk / Symbol | Minified Bytes | % of File | % of Total JS | Est. `dist/index.html` | Est. `dist/game.zip` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `Ship.render()` method | 944 B | 16.24% | 2.38% | 433 B | 327 B |
| `Ship.fracture()` method | 828 B | 14.25% | 2.09% | 379 B | 287 B |
| `Ship.hitboxes()` method | 551 B | 9.48% | 1.39% | 252 B | 191 B |
| `class Ship` (header & metadata) | 486 B | 8.36% | 1.23% | 223 B | 169 B |
| `Ship.update()` method | 470 B | 8.09% | 1.19% | 215 B | 163 B |
| `mustang` hull data object | 460 B | 7.91% | 1.16% | 211 B | 160 B |
| `makeSegment()` helper | 409 B | 7.04% | 1.03% | 187 B | 142 B |
| `Ship.fixHull()` method | 248 B | 4.27% | 0.63% | 114 B | 86 B |
| `Ship.constructor()` method | 245 B | 4.22% | 0.62% | 112 B | 85 B |
| `Ship.detach()` method | 237 B | 4.08% | 0.60% | 109 B | 82 B |
| Other / Terser IIFE Wrapper | 193 B | 3.32% | 0.49% | 88 B | 67 B |
| `damage()` helper function | 124 B | 2.13% | 0.31% | 57 B | 43 B |
| `Ship.fit()` method | 109 B | 1.88% | 0.28% | 50 B | 38 B |
| `Ship.get slots()` getter | 56 B | 0.96% | 0.14% | 26 B | 19 B |
| `Ship.fly()` method | 53 B | 0.91% | 0.13% | 24 B | 18 B |
| `bounceOf()` helper function | 41 B | 0.71% | 0.10% | 19 B | 14 B |
| `Ship.get forwardThrust()` getter | 36 B | 0.62% | 0.09% | 16 B | 12 B |
| `Ship.get maxSpeed()` getter | 34 B | 0.58% | 0.09% | 16 B | 12 B |
| `Ship.supply()` method | 33 B | 0.57% | 0.08% | 15 B | 11 B |
| `nozzleLevel()` helper function | 30 B | 0.52% | 0.08% | 14 B | 10 B |
| `active()` helper function | 28 B | 0.48% | 0.07% | 13 B | 10 B |
| `Ship.unfit()` method | 28 B | 0.48% | 0.07% | 13 B | 10 B |
| `Ship.momentum()` method | 28 B | 0.48% | 0.07% | 13 B | 10 B |
| `glowStrength` & constants | 27 B | 0.46% | 0.07% | 12 B | 9 B |
| `Ship.toggle()` method | 26 B | 0.45% | 0.07% | 12 B | 9 B |
| `approach()` helper function | 20 B | 0.34% | 0.05% | 9 B | 7 B |
| `Ship.add()` method | 16 B | 0.28% | 0.04% | 7 B | 6 B |
| Imports & Module Setup | 13 B | 0.22% | 0.03% | 6 B | 5 B |
| `Ship.get rotationalThrust()` getter | 9 B | 0.15% | 0.02% | 4 B | 3 B |
| `healthOf()` helper function | 9 B | 0.15% | 0.02% | 4 B | 3 B |
| `centerOf()` helper function | 9 B | 0.15% | 0.02% | 4 B | 3 B |
| `Ship.remove()` method | 7 B | 0.12% | 0.02% | 3 B | 2 B |
| `hullBounciness` constant | 5 B | 0.09% | 0.01% | 2 B | 2 B |

---

## Detailed Component Breakdown: `src/ui/docked.js` (3,134 B total)

Below is the code-chunk level breakdown of [src/ui/docked.js](src/ui/docked.js) post-optimization (down from 4,622 B, representing a **1,488 B / 32.2% reduction** in file size and **415 B reduction** in final ZIP size).

| Code Chunk / Symbol | Minified Bytes | % of File | % of Total JS | Est. `dist/index.html` | Est. `dist/game.zip` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `renderDocked()` export function | 1,528 B | 48.76% | 4.01% | 706 B | 534 B |
| `confirmSelection()` export function | 619 B | 19.75% | 1.62% | 286 B | 216 B |
| `moveSelection()` export function | 237 B | 7.56% | 0.62% | 110 B | 83 B |
| `renderButton()` helper function | 174 B | 5.55% | 0.46% | 80 B | 61 B |
| `actionsOf()` helper function | 144 B | 4.59% | 0.38% | 67 B | 50 B |
| `cargoOf()` helper function | 118 B | 3.77% | 0.31% | 55 B | 41 B |
| Other / Terser IIFE Wrapper | 64 B | 2.04% | 0.17% | 30 B | 22 B |
| `hullActionsOf()` helper function | 56 B | 1.79% | 0.15% | 26 B | 20 B |
| `back()` export function | 39 B | 1.24% | 0.10% | 18 B | 14 B |
| `moduleOf()` helper function | 36 B | 1.15% | 0.09% | 17 B | 13 B |
| `menuActions()` helper function | 35 B | 1.12% | 0.09% | 16 B | 12 B |
| Layout constants & State variables (`mountOption`, `stage`, `rowGap`, etc.) | 69 B | 2.20% | 0.18% | 32 B | 24 B |
| `moveSubSelection` export (alias to `moveSelection`) | 3 B | 0.10% | 0.01% | 1 B | 1 B |
| Imports & Module Setup | 3 B | 0.10% | 0.01% | 1 B | 1 B |

---

## Takeaways & Size Insights

1. **Top Files Concentration**:
   * **Top 2 files** (`src/ship.js` + `src/ui/docked.js`) account for **23.47%** of all JavaScript (8,946 minified bytes, ~3,126 bytes in `game.zip`).
   * **Top 5 files** (`src/ship.js`, `src/ui/docked.js`, `src/prism.js`, `src/asteroid.js`, `src/collisions.js`) account for **43.80%** of all JavaScript (16,694 minified bytes, ~5,833 bytes in `game.zip`).
   * **Top 10 files** account for **64.33%** of the total JS payload.

2. **`src/ui/docked.js` Rewrite Impact (Saved -1,488 B Minified / -415 B ZIP)**:
   * **`renderDocked()`**: Reduced from **1,900 B to 1,528 B** (-372 B / -19.6%) by streamlining panel/button calculations and labels.
   * **`confirmSelection()`**: Reduced from **1,145 B to 619 B** (-526 B / -45.9%) through consolidated branching and extraction of common helpers.
   * **`moveSelection()` & `moveSubSelection()`**: Reduced from **711 B combined to 240 B combined** (-471 B / -66.2%) by aliasing `moveSubSelection = moveSelection` and extracting helper lookups (`moduleOf`, `menuActions`).

3. **`src/ship.js` Internal Dominance (5,812 B total)**:
   * **Rendering & Physics/Debris**: `Ship.render()` (944 B, 16.24%), `Ship.fracture()` (828 B, 14.25%), and `Ship.hitboxes()` (551 B, 9.48%) make up nearly **40%** of the file (2,323 B total).
   * **Data Objects & Helpers**: `mustang` hull definition array (460 B) and `makeSegment()` helper (409 B) together cost 869 B (~15% of the file).
   * **`Ship` Class Machinery**: Class declaration header, constructor, `update()`, and `fixHull()` together account for 1,449 B (~25% of the file).

4. **Subfolder Aggregates**:
   * **`src/ui/`**: 4,405 minified bytes (**11.56%** of JS, ~1,539 B in `game.zip`) — down from 5,893 B.
   * **`src/modules/`**: 1,521 minified bytes (**3.99%** of JS, ~531 B in `game.zip`).
   * **`src/items/`**: 689 minified bytes (**1.81%** of JS, ~241 B in `game.zip`).

5. **Zero-Byte Files & Dead Code Elimination**:
   * Files wrapped under `// @ifdef DEBUG` or `// @ifdef BENCHMARK` (`src/benchmark.js`, `src/colors-demo.js`, `src/fps.js`, `src/section-test.js`, `src/text-demo.js`) are completely eliminated in `build:full` mode during `viteJs13kPre` pre-processing.
   * Dead source files (`src/craft-render.js`, `src/debug.js`, `src/items/cache.js`, `src/items/platinum.js`, `src/modules/index.js`, `src/modules/thruster-single-md.js`, `src/particles.js`, `src/road.js`) have 0 imports or are fully tree-shaken by Rollup, costing 0 bytes in release builds.
