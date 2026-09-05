# Build Size Breakdown (`build:full`)

This document provides the byte-level breakdown of all source JavaScript files in `src/` after Vite + Terser minification, along with estimated sizes after Roadroller JS packing in `dist/index.html` and `advzip` DEFLATE compression in `dist/game.zip`.

For the complete methodology, sourcemap VLQ decoding script, and tool inner-workings, see [.agents/skills/build-size-analysis/SKILL.md](.agents/skills/build-size-analysis/SKILL.md).

---

## Build Totals Baseline

* **`dist/minified.js` Total**: 38,676 bytes (38,633 B mapped source code + 43 B bundle wrapper).
* **`dist/index.html` Total**: 17,795 bytes (~46.01% of minified JS size after Roadroller packing & HTML minification).
* **`dist/game.zip` Total**: 13,452 bytes (~34.78% of minified JS size, ~75.60% of HTML size after `advzip` compression).

---

## Source File Breakdown

| File Path | Minified Bytes | % of JS | Est. `dist/index.html` | Est. `dist/game.zip` | Status |
| :--- | :---: | :---: | :---: | :---: | :--- |
| [src/ship.js](src/ship.js) | 5,726 B | 14.81% | 2,635 B | 1,992 B | Included |
| [src/ui/docked.js](src/ui/docked.js) | 3,709 B | 9.59% | 1,707 B | 1,290 B | Included |
| [src/prism.js](src/prism.js) | 3,038 B | 7.86% | 1,398 B | 1,057 B | Included |
| [src/asteroid.js](src/asteroid.js) | 2,737 B | 7.08% | 1,259 B | 952 B | Included |
| [src/collisions.js](src/collisions.js) | 1,976 B | 5.11% | 909 B | 687 B | Included |
| [src/lighting.js](src/lighting.js) | 1,901 B | 4.92% | 875 B | 661 B | Included |
| [src/text.js](src/text.js) | 1,619 B | 4.19% | 745 B | 563 B | Included |
| [src/background.js](src/background.js) | 1,517 B | 3.92% | 698 B | 528 B | Included |
| [src/main.js](src/main.js) | 1,513 B | 3.91% | 696 B | 526 B | Included |
| [src/item.js](src/item.js) | 1,289 B | 3.33% | 593 B | 448 B | Included |
| [src/mining.js](src/mining.js) | 956 B | 2.47% | 440 B | 333 B | Included |
| [src/station.js](src/station.js) | 923 B | 2.39% | 425 B | 321 B | Included |
| [src/vector.js](src/vector.js) | 920 B | 2.38% | 423 B | 320 B | Included |
| [src/world.js](src/world.js) | 907 B | 2.35% | 417 B | 315 B | Included |
| [src/explosion.js](src/explosion.js) | 837 B | 2.16% | 385 B | 291 B | Included |
| [src/ui/controls.js](src/ui/controls.js) | 633 B | 1.64% | 291 B | 220 B | Included |
| [src/resolve.js](src/resolve.js) | 601 B | 1.55% | 277 B | 209 B | Included |
| [src/ui/indicators.js](src/ui/indicators.js) | 599 B | 1.55% | 276 B | 208 B | Included |
| [src/drawing.js](src/drawing.js) | 475 B | 1.23% | 219 B | 165 B | Included |
| [src/sprite.js](src/sprite.js) | 450 B | 1.16% | 207 B | 157 B | Included |
| [src/shrapnel.js](src/shrapnel.js) | 446 B | 1.15% | 205 B | 155 B | Included |
| [src/colors.js](src/colors.js) | 369 B | 0.95% | 170 B | 128 B | Included |
| [src/docking.js](src/docking.js) | 368 B | 0.95% | 169 B | 128 B | Included |
| [src/modules/shield.js](src/modules/shield.js) | 309 B | 0.80% | 142 B | 107 B | Included |
| [src/player.js](src/player.js) | 291 B | 0.75% | 134 B | 101 B | Included |
| [src/modules/cargo-scoop.js](src/modules/cargo-scoop.js) | 279 B | 0.72% | 128 B | 97 B | Included |
| [src/polygon.js](src/polygon.js) | 274 B | 0.71% | 126 B | 95 B | Included |
| [src/camera.js](src/camera.js) | 267 B | 0.69% | 123 B | 93 B | Included |
| [src/distribute.js](src/distribute.js) | 260 B | 0.67% | 120 B | 90 B | Included |
| [src/set-sizing.js](src/set-sizing.js) | 260 B | 0.67% | 120 B | 90 B | Included |
| [src/scoop.js](src/scoop.js) | 257 B | 0.66% | 118 B | 89 B | Included |
| [src/modules/horn.js](src/modules/horn.js) | 249 B | 0.64% | 115 B | 87 B | Included |
| [src/game-loop.js](src/game-loop.js) | 246 B | 0.64% | 113 B | 86 B | Included |
| [src/items/message.js](src/items/message.js) | 243 B | 0.63% | 112 B | 85 B | Included |
| [src/local-movement.js](src/local-movement.js) | 243 B | 0.63% | 112 B | 85 B | Included |
| [src/ui.js](src/ui.js) | 180 B | 0.47% | 83 B | 63 B | Included |
| [src/outline.js](src/outline.js) | 178 B | 0.46% | 82 B | 62 B | Included |
| [src/game.js](src/game.js) | 162 B | 0.42% | 75 B | 56 B | Included |
| [src/modules/floodlight.js](src/modules/floodlight.js) | 159 B | 0.41% | 73 B | 55 B | Included |
| [src/keyboard.js](src/keyboard.js) | 154 B | 0.40% | 71 B | 54 B | Included |
| [src/modules/thruster-triple.js](src/modules/thruster-triple.js) | 134 B | 0.35% | 62 B | 47 B | Included |
| [src/items/explosive.js](src/items/explosive.js) | 119 B | 0.31% | 55 B | 41 B | Included |
| [src/modules/thruster-dual-xl.js](src/modules/thruster-dual-xl.js) | 116 B | 0.30% | 53 B | 40 B | Included |
| [src/modules/thruster-dual-md.js](src/modules/thruster-dual-md.js) | 115 B | 0.30% | 53 B | 40 B | Included |
| [src/items/gold.js](src/items/gold.js) | 101 B | 0.26% | 46 B | 35 B | Included |
| [src/items/diamond.js](src/items/diamond.js) | 91 B | 0.24% | 42 B | 32 B | Included |
| [src/modules/thruster-single-xl.js](src/modules/thruster-single-xl.js) | 87 B | 0.22% | 40 B | 30 B | Included |
| [src/items/amethyst.js](src/items/amethyst.js) | 75 B | 0.19% | 35 B | 26 B | Included |
| [src/flare.js](src/flare.js) | 67 B | 0.17% | 31 B | 23 B | Included |
| [src/items/opal.js](src/items/opal.js) | 59 B | 0.15% | 27 B | 21 B | Included |
| [src/seeded-random.js](src/seeded-random.js) | 51 B | 0.13% | 23 B | 18 B | Included |
| [src/core.js](src/core.js) | 47 B | 0.12% | 22 B | 16 B | Included |
| [src/modules/index.js](src/modules/index.js) | 44 B | 0.11% | 20 B | 15 B | Included |
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
| [src/modules/thruster-single-md.js](src/modules/thruster-single-md.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/particles.js](src/particles.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |
| [src/road.js](src/road.js) | 0 B | 0.00% | 0 B | 0 B | Unused / Tree-shaken |

---

## Detailed Component Breakdown: `src/ship.js` (5,726 B total)

Below is the code-chunk level breakdown of [src/ship.js](src/ship.js) (the largest single file in the build, representing 14.81% of minified JS).

| Code Chunk / Symbol | Minified Bytes | % of File | % of Total JS | Est. `dist/index.html` | Est. `dist/game.zip` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `Ship.render()` method | 944 B | 16.49% | 2.44% | 434 B | 328 B |
| `Ship.fracture()` method | 822 B | 14.36% | 2.13% | 378 B | 286 B |
| `Ship.hitboxes()` method | 572 B | 9.99% | 1.48% | 263 B | 199 B |
| `class Ship` (header & metadata) | 512 B | 8.94% | 1.32% | 236 B | 178 B |
| `mustang` hull data object | 470 B | 8.21% | 1.22% | 216 B | 163 B |
| `Ship.update()` method | 452 B | 7.89% | 1.17% | 208 B | 157 B |
| `makeSegment()` helper | 381 B | 6.65% | 0.99% | 175 B | 133 B |
| `Ship.detach()` method | 261 B | 4.56% | 0.67% | 120 B | 91 B |
| `Ship.fixHull()` method | 226 B | 3.95% | 0.58% | 104 B | 79 B |
| `Ship.constructor()` method | 164 B | 2.86% | 0.42% | 75 B | 57 B |
| `Ship.fit()` method | 138 B | 2.41% | 0.36% | 63 B | 48 B |
| `damage()` helper function | 124 B | 2.17% | 0.32% | 57 B | 43 B |
| Other / Terser IIFE Wrapper | 123 B | 2.15% | 0.32% | 57 B | 43 B |
| `Ship.fly()` method | 67 B | 1.17% | 0.17% | 31 B | 23 B |
| `Ship.partsOf()` method | 48 B | 0.84% | 0.12% | 22 B | 17 B |
| `Ship.get maxSpeed()` getter | 45 B | 0.79% | 0.12% | 21 B | 16 B |
| `Ship.get mounts()` getter | 44 B | 0.77% | 0.11% | 20 B | 15 B |
| `Ship.get forwardThrust()` getter | 36 B | 0.63% | 0.09% | 17 B | 13 B |
| `Ship.get cargoBay()` getter | 34 B | 0.59% | 0.09% | 16 B | 12 B |
| `Ship.supply()` method | 33 B | 0.58% | 0.09% | 15 B | 11 B |
| `centerOf()` helper function | 30 B | 0.52% | 0.08% | 14 B | 10 B |
| `active()` helper function | 28 B | 0.49% | 0.07% | 13 B | 10 B |
| `Ship.momentum()` method | 28 B | 0.49% | 0.07% | 13 B | 10 B |
| `glowStrength` & constants | 27 B | 0.47% | 0.07% | 12 B | 9 B |
| `Ship.toggle()` method | 26 B | 0.45% | 0.07% | 12 B | 9 B |
| `healthOf()` helper function | 25 B | 0.44% | 0.06% | 12 B | 9 B |
| `approach()` helper function | 20 B | 0.35% | 0.05% | 9 B | 7 B |
| `Ship.add()` method | 16 B | 0.28% | 0.04% | 7 B | 6 B |
| Imports & Module Setup | 13 B | 0.23% | 0.03% | 6 B | 5 B |
| `Ship.remove()` method | 7 B | 0.12% | 0.02% | 3 B | 2 B |
| `hullBounciness` constant | 5 B | 0.09% | 0.01% | 2 B | 2 B |
| `Ship.get rotationalThrust()` getter | 5 B | 0.09% | 0.01% | 2 B | 2 B |

*Note*: `nozzleLevel`/`unfit`/`bounceOf` from earlier measurements were folded into `partsOf()`/`fit()`/`hitboxes()` in the current rewrite; `mounts`/`cargoBay` are now getters rather than constructor-assigned arrays.

---

## Detailed Component Breakdown: `src/ui/docked.js` (3,709 B total)

Below is the code-chunk level breakdown of [src/ui/docked.js](src/ui/docked.js), following the reintroduction of module paint/colour swatches (up from the previous 3,134 B measurement, a **+575 B** increase, but still **913 B / 19.7% smaller** than the original pre-optimization 4,622 B version).

| Code Chunk / Symbol | Minified Bytes | % of File | % of Total JS | Est. `dist/index.html` | Est. `dist/game.zip` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `renderDocked()` export function | 1,687 B | 45.48% | 4.36% | 776 B | 587 B |
| `confirmSelection()` export function | 604 B | 16.28% | 1.56% | 278 B | 210 B |
| `moveSelection()` export function | 324 B | 8.74% | 0.84% | 149 B | 113 B |
| `selectionOf()` helper function | 262 B | 7.06% | 0.68% | 121 B | 91 B |
| `renderButton()` helper function | 174 B | 4.69% | 0.45% | 80 B | 61 B |
| Other / Terser IIFE Wrapper | 123 B | 3.32% | 0.32% | 57 B | 43 B |
| `actionsOf()` helper function | 114 B | 3.07% | 0.29% | 52 B | 40 B |
| `fitsOf()` helper function | 99 B | 2.67% | 0.26% | 46 B | 34 B |
| `cargoOf()` helper function | 97 B | 2.62% | 0.25% | 45 B | 34 B |
| `hullActionsOf()` helper function | 64 B | 1.73% | 0.17% | 29 B | 22 B |
| Layout/state variables (`mountOption`, `colGap`, `moduleOption`, `focused`, `stage`, `listInset`, `rowGap`, `textSize`, `swatchSize`) | 31 B | 0.84% | 0.08% | 14 B | 11 B |
| `back()` export function | 30 B | 0.81% | 0.08% | 14 B | 10 B |
| `paints` swatch palette constant | 17 B | 0.46% | 0.04% | 8 B | 6 B |
| `cargoName()` helper function | 16 B | 0.43% | 0.04% | 7 B | 6 B |
| `moveSubSelection` export (alias) | 14 B | 0.38% | 0.04% | 6 B | 5 B |
| `rowPad` constant | 14 B | 0.38% | 0.04% | 6 B | 5 B |
| `textPad` constant | 14 B | 0.38% | 0.04% | 6 B | 5 B |
| `swatchInset` constant | 13 B | 0.35% | 0.03% | 6 B | 5 B |
| Imports & Module Setup | 3 B | 0.08% | 0.01% | 1 B | 1 B |

---

## Takeaways & Size Insights

1. **Top Files Concentration**:
   * **Top 2 files** (`src/ship.js` + `src/ui/docked.js`) account for **24.40%** of all JavaScript (9,435 minified bytes, ~3,282 bytes in `game.zip`).
   * **Top 5 files** (`src/ship.js`, `src/ui/docked.js`, `src/prism.js`, `src/asteroid.js`, `src/collisions.js`) account for **44.35%** of all JavaScript (17,186 minified bytes, ~5,988 bytes in `game.zip`).
   * **Top 10 files** account for **65.02%** of the total JS payload.

2. **`src/ui/docked.js` Colour Swatch Re-addition (+575 B Minified vs. prior measurement)**:
   * New `paints` palette constant (17 B), `swatchInset`/`swatchSize` layout constants, and swatch-rendering logic folded into `renderDocked()` (up from 1,528 B to 1,687 B, **+159 B**) restore per-mount/per-hull colour selection for modules.
   * `selectionOf()` (262 B) is a new consolidated helper replacing the previous `moduleOf()` + `menuActions()` pair (was 71 B combined), now also resolving swatch selection state in one place.
   * `confirmSelection()` shrank slightly (604 B vs. 619 B in the prior no-colour measurement — a **15 B decrease** despite the new swatch-picking branch, from continued consolidation).
   * Net effect: still **913 B / 19.7% smaller** than the original pre-rewrite `docked.js` (4,622 B), even with paint swatches restored.

3. **`src/ship.js` Internal Dominance (5,726 B total)**:
   * **Rendering & Physics/Debris**: `Ship.render()` (944 B, 16.49%), `Ship.fracture()` (822 B, 14.36%), and `Ship.hitboxes()` (572 B, 9.99%) make up **40.84%** of the file (2,338 B total).
   * **Data Objects & Helpers**: `mustang` hull definition array (470 B) and `makeSegment()` helper (381 B) together cost 851 B (~14.86% of the file).
   * **`Ship` Class Machinery**: Class declaration header, constructor, `update()`, and `fixHull()` together account for 1,354 B (~23.65% of the file).
   * Getters `mounts`/`cargoBay` (previously plain constructor-assigned arrays) now cost only 78 B combined as computed properties.

4. **Subfolder Aggregates**:
   * **`src/ui/`**: 4,941 minified bytes (**12.78%** of JS, ~1,719 B in `game.zip`).
   * **`src/modules/`**: 1,565 minified bytes (**4.05%** of JS, ~545 B in `game.zip`).
   * **`src/items/`**: 689 minified bytes (**1.78%** of JS, ~240 B in `game.zip`).

5. **Zero-Byte Files & Dead Code Elimination**:
   * Files wrapped under `// @ifdef DEBUG` or `// @ifdef BENCHMARK` (`src/benchmark.js`, `src/colors-demo.js`, `src/fps.js`, `src/section-test.js`, `src/text-demo.js`) are completely eliminated in `build:full` mode during `viteJs13kPre` pre-processing.
   * Dead source files (`src/craft-render.js`, `src/debug.js`, `src/items/cache.js`, `src/items/platinum.js`, `src/modules/thruster-single-md.js`, `src/particles.js`, `src/road.js`) have 0 imports or are fully tree-shaken by Rollup, costing 0 bytes in release builds. `src/modules/index.js` is now included at 44 B (previously fully tree-shaken).

