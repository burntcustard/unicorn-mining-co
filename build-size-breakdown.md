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

## Detailed Component Breakdown: `src/ui/docked.js` (4,622 B total)

Below is the code-chunk level breakdown of [src/ui/docked.js](src/ui/docked.js) (the second largest file, representing 11.67% of minified JS).

| Code Chunk / Symbol | Minified Bytes | % of File | % of Total JS | Est. `dist/index.html` | Est. `dist/game.zip` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `renderDocked()` export function | 1,900 B | 41.11% | 4.80% | 871 B | 659 B |
| `confirmSelection()` export function | 1,145 B | 24.77% | 2.89% | 525 B | 397 B |
| `moveSelection()` export function | 471 B | 10.19% | 1.19% | 216 B | 163 B |
| `moveSubSelection()` export function | 240 B | 5.19% | 0.61% | 110 B | 83 B |
| `renderButton()` helper function | 179 B | 3.87% | 0.45% | 82 B | 62 B |
| `actionsOf()` helper function | 139 B | 3.01% | 0.35% | 64 B | 48 B |
| Other / Terser IIFE Wrapper | 120 B | 2.60% | 0.30% | 55 B | 42 B |
| `cargoOf()` helper function | 118 B | 2.55% | 0.30% | 54 B | 41 B |
| Layout constants & State variables (`mountOption`, `stage`, etc.) | 108 B | 2.34% | 0.27% | 49 B | 37 B |
| `layoutButtons()` helper function | 79 B | 1.71% | 0.20% | 36 B | 27 B |
| `hullActionsOf()` helper function | 58 B | 1.25% | 0.15% | 27 B | 20 B |
| `back()` export function | 42 B | 0.91% | 0.11% | 19 B | 15 B |
| `paintsOf()` helper function | 18 B | 0.39% | 0.05% | 8 B | 6 B |
| Imports & Module Setup | 5 B | 0.11% | 0.01% | 2 B | 2 B |

---

## Takeaways & Size Insights

1. **Top Files Concentration**:
   * **Top 2 files** (`src/ship.js` + `src/ui/docked.js`) account for **26.35%** of all JavaScript (10,434 minified bytes, ~3,619 bytes in `game.zip`).
   * **Top 5 files** (`src/ship.js`, `src/ui/docked.js`, `src/prism.js`, `src/asteroid.js`, `src/collisions.js`) account for **45.91%** of all JavaScript (18,182 minified bytes, ~6,306 bytes in `game.zip`).
   * **Top 10 files** account for **65.88%** of the total JS payload.

2. **`src/ship.js` Internal Dominance (5,812 B total)**:
   * **Rendering & Physics/Debris**: `Ship.render()` (944 B, 16.24%), `Ship.fracture()` (828 B, 14.25%), and `Ship.hitboxes()` (551 B, 9.48%) make up nearly **40%** of the file (2,323 B total).
   * **Data Objects & Helpers**: `mustang` hull definition array (460 B) and `makeSegment()` helper (409 B) together cost 869 B (~15% of the file).
   * **`Ship` Class Machinery**: Class declaration header, constructor, `update()`, and `fixHull()` together account for 1,449 B (~25% of the file).

3. **`src/ui/docked.js` Internal Dominance (4,622 B total)**:
   * **Rendering**: `renderDocked()` alone takes **1,900 B** (41.11% of the file, 4.80% of all minified JS).
   * **State & Interaction Handling**: `confirmSelection()` takes **1,145 B** (24.77% of the file) and `moveSelection()` takes **471 B** (10.19% of the file).
   * **Combined Impact**: These 3 functions alone constitute **76.07%** of `src/ui/docked.js` (3,516 B total, ~1,219 B in `game.zip`).

4. **Subfolder Aggregates**:
   * **`src/ui/`**: 5,893 minified bytes (**14.88%** of JS, ~2,044 B in `game.zip`).
   * **`src/modules/`**: 1,521 minified bytes (**3.84%** of JS, ~528 B in `game.zip`).
   * **`src/items/`**: 689 minified bytes (**1.74%** of JS, ~239 B in `game.zip`).

5. **Zero-Byte Files & Dead Code Elimination**:
   * Files wrapped under `// @ifdef DEBUG` or `// @ifdef BENCHMARK` (`src/benchmark.js`, `src/colors-demo.js`, `src/fps.js`, `src/section-test.js`, `src/text-demo.js`) are completely eliminated in `build:full` mode during `viteJs13kPre` pre-processing.
   * Dead source files (`src/craft-render.js`, `src/debug.js`, `src/items/cache.js`, `src/items/platinum.js`, `src/modules/index.js`, `src/modules/thruster-single-md.js`, `src/particles.js`, `src/road.js`) have 0 imports or are fully tree-shaken by Rollup, costing 0 bytes in release builds.
