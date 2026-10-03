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
| Interaction | `src/client/audio/sound`              | First keyboard input after the playable game is ready | The same input calls `unlockAudio()`                                                                                 |
| Docked      | `src/client/ui/docked`                | The first docked render or docked-menu key press      | Once the module finishes loading                                                                                     |

The boot renderer stays active during the 0.2-second hold. The docked-camera
easing then pans the same sky from the intro origin to the starting station;
the HUD starts fading in when that four-second pan ends. Sound and docked
facades queue input made while loading.

The inline boot entry lives in `src/client/background/background-boot.ts`.
Background tiles live alongside it; camera code lives in `src/client/camera.ts`,
UI text in `src/client/ui/text`, event effects in `src/client/effects`, and
shared drawing and lighting helpers in `src/client/utilities`. These moves
preserve the fetch and execution triggers above.

The browser object hierarchy and its render methods load together in the entry.
Render and visual-update methods belong to their classes and use normal
inheritance; no side-effect imports install them. Canvas setup happens in
`main` before the first frame, so importing objects for prediction needs no DOM.
Keep runtime objects and their GameObject base in the same initial hierarchy:
that can introduce a cyclic chunk dependency during class initialization.

## Adding a loading boundary

- Use a static import for code required before the first frame.
- Use `import()` only for a concrete later trigger.
- Add any new trigger to the table and verify a production build.

## Production contracts

The browser production build uses `plugins/build-plugins.js`. Source rewrites
strip development flags, shorten internal client tags from `plugins/protocol-tags.js`,
and mark app-owned properties from `plugins/property-names.js`. The rewrite in
`plugins/replace-pre-terser.js` skips quoted paths.

The build scans client and definition TypeScript exports and reserves their
names, including the
`renderBackground` API exposed by the separately built inline boot script.
It seeds one shared property cache in source-path order, then mangles each
source module before Rolldown assigns it to a chunk. This keeps lazy imports
consistent and builds deterministic. Oxc compresses the chunks and a final
Terser pass shortens lexical names. The build annotates computed checkpoint
keys so they follow the same property map; native browser properties stay
protected. Go's catalog and numeric binary wire IDs are independent of these
JavaScript names.

WebSocket messages use only versioned binary frames: `UC` for
client controls and server welcome/respawn, and `UM` for load/snapshot state.
Input frames contain a packed control byte; snapshots use fixed numeric field
identifiers, independent of JavaScript property names. The server assigns
connection-local snapshot sequences and starts with two snapshots outstanding
per player, including initial and respawn loads. Prompt ordinary receipts expand
the bounded window to nine, sustaining 30 Hz through a 267 ms round trip plus
tick phasing; slower receipts reduce it to two again. The client acknowledges each
snapshot after decoding; simulation and input run at 30 Hz and ordinary state
snapshots also run at 30 Hz. Skipped sends do not advance replication baselines, so
the next send contains current changes. Client and server production assets must
be built and released together.
Untouched procedural asteroids recreate their segments from shared seeds instead
of receiving them. Each player receives a full entity record on entry, then
only fields that changed; `null` clears a field. Unchanged player ships use
ordinary delta omission; render prediction does not require heartbeat records.
All visible bodies use unfinished-tick prediction with a statically imported,
bounded Hermite pose helper. Frame prediction draws between a common checkpoint
and full physics endpoint; remote ships have no separate playback buffer.
Load records provide their own IDs, and later interest sets are sent only when
membership changes. Values
the client can reconstruct are omitted. The client expands records
before prediction. Browser and Go simulation round positions,
velocity, rotation and spin to a binary grid of 2^-24, using ties to even on
both Go and JavaScript. This lets Go use its native rounding instruction and
keeps prediction consistent. Generated asteroid geometry still uses eight
decimal places. Snapshot motion fields use fixed-width float64 values, so
their encoded width does not depend on the rounding rule. The `object` tag stays
long because JavaScript's `typeof` uses that literal.
`npm run start:server` runs `bin/server`, which serves those assets.

Both lazy facades load a typed default API object. `npm run test lazy-docked`
exercises the real docked loader against separately emitted production chunks,
including shared mangled state in the ship chunk.
`npm run test property-mangling` checks that a private property is mangled
consistently across two chunks. `npm run test:packets`
measures real Go WebSocket packet sizes and checks that both source and
production-mangled client codecs acknowledge snapshots and receive input receipts. Keep the lazy boundary
intact in tests: bundling everything into one file masked the original
cargo-menu crash.

Ship/station binary field 34 optionally identifies a nondefault content definition.
Existing fields and resource/module IDs retain their values. Registry lookups
use maps or ordered arrays rather than dynamic property names.
