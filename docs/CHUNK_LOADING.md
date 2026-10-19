# JavaScript chunk loading

The production build targets at most 14,000 gzip-level-1 bytes per JavaScript
chunk and warns when a chunk exceeds that budget. See
[`plugins/build-plugins.ts`](../plugins/build-plugins.ts) for the size check and
chunk transforms.

## Loading triggers

| Resource                          | Trigger                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline background renderer        | HTML parsing. Built separately from `src/client/background/background-boot.ts`.                                                                     |
| `index` and shared CSS            | HTML parsing. Mounts the main menu without gameplay or ship rendering.                                                                              |
| `menu-screens`                    | First navigation to Settings, Saves, or Credits, or Play when the authenticated account needs a profile name.                                       |
| `ship-preview`                    | After the main menu's first paint. Play cancels a pending preview.                                                                                  |
| `gameplay`                        | After the ship preview paints, or immediately on Play. Authenticates the connection; Play enters the world and starts the game loop.                |
| `sound`                           | Gameplay preparation loads the code. Play initializes audio alongside world entry; gameplay keyboard input also unlocks it if suspended.            |
| `docked`, its CSS, and SVG assets | Gameplay preparation loads the assets. The screen opens when the predicted ship is docked, launch is not pending, and no other HTML screen is open. |

Shared dependency chunks, including `ship`, `shield`, and `keybindings`, load
with their importers. They have no independent loading trigger. Keep the runtime
object hierarchy together to avoid class-initialization cycles.

Preparation follows the preview's first paint, including a default or cached
preview while saved identity verification is pending. Native module caching lets
Play reuse background loading. Gameplay prepares docking, audio, and the font
in parallel with authentication. Only Play sends the world-entry request;
prepared connections receive no world snapshots, activate no nearby physics,
and accumulate no playtime. Returning ships remain hidden until Play too.
Loading gameplay does not start the game loop or change Play to Resume.
The font remains preloaded by HTML.

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
The browser tests verify menu loading triggers and exercise the real docking
loader with separately emitted production-transformed chunks. Bundling both
sides into one test file cannot validate that boundary. See the
[browser test instructions](../README.md#browser-tests) for setup and commands.
