# JavaScript chunk loading

Every JavaScript chunk must be at most 14 KB (14,000 gzip-level-1 bytes).
That leaves headroom inside the 14,600-byte initial TCP window. `npm run build`
warns when a chunk exceeds the target. See [Critical Resources and the First
14 KB](https://www.tunetheweb.com/blog/critical-resources-and-the-first-14kb/).

## Current loading triggers

| Tier        | Resource                              | Fetch trigger                                         | Execution trigger                                                                                                    |
| ----------- | ------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Boot        | Inline canvas and background renderer | HTML parsing                                          | Paints the intro sky and fades in                                                                                    |
| Initial     | `index`                               | Vite's module-script link during HTML parsing         | Builds the game, starts its camera after a 0.2-second intro hold, then fades in its UI when the four-second pan ends |
| Interaction | `src/client/sound`                    | First keyboard input after the playable game is ready | The same input calls `unlockAudio()`                                                                                 |
| Docked      | `src/client/ui/docked`                | The first docked render or docked-menu key press      | Once the module finishes loading                                                                                     |

The boot renderer stays active during the 0.2-second hold. The docked-camera
easing then pans the same sky from the intro origin to the starting station;
the HUD starts fading in when that four-second pan ends. Sound and docked
facades queue input made while loading.

The shared class hierarchy and its client renderers load together in the entry.
Do not force item subclasses into a separate chunk from their GameObject base:
that can introduce a cyclic chunk dependency during class initialization.

## Adding a loading boundary

- Use a static import for code required before the first frame.
- Use `import()` only for a concrete later trigger.
- Add any new trigger to the table and verify a production build.

## Production contracts

Both production entry points use `plugins/build-plugins.js`; the server runner
lives beside it in `plugins/build-server.js`. Production minification mangles
object properties in each source module before Rolldown splits the code into
chunks. The client and server builds seed Terser's
property name cache from the same source files in the same order, so lazy chunks
and JSON packets use matching short keys. The build prefixes audited app-owned
properties from `plugins/property-names.js` with the small regex in
`replace-pre-terser.js`, then lets Terser shorten them. The regex skips
quoted paths, so `distance` can be mangled without changing imports of
`shape-distance`. Exact message,
entity, event and equipment tags in `plugins/protocol-tags.js` get shared
one-byte values on both sides. Input transitions use positional JSON arrays
`[tick, sequence, controlBits, offset?]`, with no field names or type tag.
Untouched procedural asteroids recreate their segments from shared seeds instead
of receiving them. Each player receives a full entity record on entry, then
only fields that changed; `null` clears a field. Load records provide their
own IDs, and later interest sets are sent only when membership changes. Values
the client can reconstruct are omitted. The client expands records
before motion tracking and prediction. Shared simulation rounds positions,
rotation and spin, and generated asteroid geometry to eight decimal places;
velocity retains full precision for collision momentum. The `object` tag stays
long because JavaScript's `typeof` uses that literal.
The build also annotates computed checkpoint keys for Terser.
Module export names and native browser/JavaScript properties remain protected.
Later Terser passes shorten lexical names and compress the bundled server.
`npm run start:server` runs that bundle from `dist/server.js`.

Both lazy facades load a typed default API object. `npm run test:docked` exercises
the real docked loader against separately emitted production chunks, including
shared mangled state in the ship chunk. It also checks that a private
property is mangled consistently across two chunks. `npm run test:packets`
measures real WebSocket packet sizes against the source server and checks that
the built server acknowledges mangled client input. Keep the lazy boundary
intact in tests: bundling everything into one file masked the original
cargo-menu crash.
