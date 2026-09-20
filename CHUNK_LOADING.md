# JavaScript chunk loading

Every JavaScript chunk must be at most 14 KB (14,000 gzip-level-1 bytes).
That leaves headroom inside the 14,600-byte initial TCP window. `npm run build`
warns when a chunk exceeds the target. See [Critical Resources and the First
14 KB](https://www.tunetheweb.com/blog/critical-resources-and-the-first-14kb/).

## Current loading triggers

| Tier | Resource | Fetch trigger | Execution trigger |
| --- | --- | --- | --- |
| Boot | Inline canvas and background renderer | HTML parsing | Paints the intro sky and fades in |
| Initial | `index` and `rendering-world` | Vite's module-script and `modulepreload` links during HTML parsing | Builds the game, starts its camera after a 0.2-second intro hold, then fades in its UI when the four-second pan ends |
| Interaction | `src/sound` | First keyboard input after the playable game is ready | The same input calls `unlockAudio()` |
| Docked | `src/ui/docked` | The first docked render or docked-menu key press | Once the module finishes loading |

The boot renderer stays active during the 0.2-second hold. The docked-camera
easing then pans the same sky from the intro origin to the starting station;
the HUD starts fading in when that four-second pan ends. Sound and docked
facades queue input made while loading.

## Adding a loading boundary

- Use a static import for code required before the first frame.
- Use `import()` only for a concrete later trigger.
- Add any new trigger to the table and verify a production build.
