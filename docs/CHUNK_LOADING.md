# JavaScript chunk loading

The production build targets at most 14,000 gzip-level-1 bytes per JavaScript
chunk and warns when a chunk exceeds that budget. See
[`plugins/build-plugins.ts`](../plugins/build-plugins.ts) for the size check and
chunk transforms.

## Loading triggers

| Resource                          | Trigger                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Inline background renderer        | HTML parsing. Built separately from `src/client/background/background-boot.ts`.           |
| `index` and shared CSS            | HTML parsing. Mounts the main menu without gameplay or ship rendering.                    |
| `menu-screens`                    | First navigation to Settings, Saves, or Credits.                                          |
| `ship-preview`                    | After the main menu's first paint. Play cancels a pending preview.                        |
| `gameplay`                        | Play. Connects to the server and starts the simulation; Resume reuses the loaded session. |
| `sound`                           | First gameplay keyboard input unlocks audio.                                              |
| `docked`, its CSS, and SVG assets | The predicted ship is docked, launch is not pending, and no other HTML screen is open.    |

Shared dependency chunks, including `ship`, `shield`, and `keybindings`, load
with their importers. They have no independent loading trigger. Keep the runtime
object hierarchy together to avoid class-initialization cycles.

## Changing a boundary

- Statically import first-frame code; use `import()` for a concrete later trigger.
- Keep lazy APIs as typed `default` objects, following
  [`sound-loader.ts`](../src/client/audio/sound-loader.ts).
- Update the trigger table when a loading boundary changes. Ordinary feature,
  styling, protocol, or spec changes do not belong in this document.
- Verify the production importer and imported chunk together. The build reserves
  exported names and uses one property-mangling cache across modules; API names
  and shared state must agree across separately emitted chunks.

`npm run test property-mangling` checks shared property names across chunks.
After `npm run build`, start `npm run dev:server` and
`npm run preview -- --strictPort`, then run `npm run test:ui`. It checks the menu
loading triggers and exercises the real docking loader with separately emitted
production-transformed chunks. Bundling both sides into one test file cannot
validate that boundary. Stop the servers after testing.
