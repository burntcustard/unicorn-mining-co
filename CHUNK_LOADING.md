# JavaScript chunk loading

Production JavaScript is delivered as several ES-module resources. Every
resource, including the code inlined into `index.html`, should be no larger than
14 KiB (14,336 UTF-8 bytes). `npm run build` shows a warning when that target is
exceeded. Vite prints its normal output-file size summary once.

## Current loading triggers

| Tier | Resource | Fetch trigger | Execution trigger |
| --- | --- | --- | --- |
| Inline | The `src/main` entry | Part of `index.html` | Normal module-script execution after HTML parsing |
| Initial | Static game chunks | Discovered from the entry and Vite's `modulepreload` links | Before the entry module can run |
| Prefetched | `src/sound` | Low-priority `prefetch` after initial resources | None; prefetch only populates the browser cache |
| Interaction | `src/sound` | Dynamic `import()` fallback if prefetch has not completed | The first keyboard event calls `unlockAudio()` |

`src/sound-loader.js` is the small always-available facade. Before interaction, sound
calls are ignored as they were previously. Once `unlockAudio()` starts loading
the runtime, an effect from that same input is queued behind the import. Looping
sounds begin on a later update after the runtime is ready.

The sound chunk is served from the same origin as the page, so `preconnect`
would not establish a connection the page does not already have. If chunks move
to a separate asset origin later, add `preconnect` for that origin and keep the
sound prefetch.

## Adding a loading boundary

- Keep code required to size the canvas and begin loading the game in the inline
  entry.
- Use a static import for code required before the first frame. ES modules are
  deferred automatically; adding classic blocking scripts, `async`, or `defer`
  does not improve their ordering.
- Use `import()` for code that has a real later trigger, such as user input,
  entering a game state, opening a screen, or reaching a region.
- Prefetch only a likely next chunk. Prefetching every deferred chunk turns the
  later tiers back into an eager download.
- Keep module initialization side-effect-free when fetching and executing are
  meant to be separate events.
- Add the trigger to the table above and verify it in a production build.

## TypeScript

TypeScript 7 is the project's type checker. Vite transpiles `.ts` modules while
`npm run typecheck` runs `tsc` with no emit before each production build. The
pre-Terser flag pass accepts both JavaScript and TypeScript, so files can move
from `.js` to `.ts` gradually without changing the loading model.

## Build responsibilities

`replace-pre-terser.js` removes compile-time `DEBUG` and `BENCHMARK` blocks,
normalizes selected identifier/property spellings, and applies the project's
other source-level minification rewrites before Terser.

Terser minifies each emitted chunk directly; there is no post-Terser rewrite.

`vite-build.js` inlines the entry, adds the sound prefetch, and warns when a
resource exceeds the 14 KiB target. It does not create a ZIP, pack code, or
estimate compressed sizes.
