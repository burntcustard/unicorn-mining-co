# Content authoring

## Specs and runtime code

Use one spec file per item, ship, or station type. Keep authored schemas next to
the specs and runtime types next to their owners. Client-only visual effect
options belong in `src/client/effects`. Use only type imports from client and
server runtime modules in specs. Cargo runs `scripts/generate-rust-catalog.ts` to embed the same
authored values used by the client.

Inline values in concrete object specs, including repeated values. Shared spec
builders such as Corral's geometry generator can use variables for their
calculations. Thruster variants share one implementation per language.

Put gameplay defaults in the appropriate spec. Item fallbacks live in
`src/specs/items/defaults.ts`, base object defaults in `src/specs/game-object.ts`,
and common craft defaults in `src/specs/craft.ts`. Keep type-specific tuning in
the individual content spec. Refer to the [save compatibility rules](../../../../docs/persistence.md#changes-to-content-and-saves)
before changing content IDs, hull layouts, or procedural generation.

## Preview objects and modules

Run `npm run tool:object-viewer` or `npm run tool:module-viewer` and open
Vite's printed URL. These viewers use the game renderers and run without the
server.

- The GameObject Viewer handles ships, stations, nav beacons, items, procedural
  asteroids, and animated portals. Select a compatible module on a mount and
  use its checkbox to activate all segments of that instance. Choose **Empty**
  for an unfitted mount.
- Hull specs use `mounts: [[{ x, y, fits: [moduleId] }, ...], ...]`. Each inner
  array is a mount with different coordinates for groups of compatible modules.
  The fitted module selects its matching entry. The grid and mouse coordinates
  stay in local spec coordinates during rotation.
- Spec and renderer edits hot-reload. New or removed spec files update the
  viewer selections independently of game catalog exports. Selection, camera,
  viewing aids, and fitted and activated modules are retained.
- The Module Viewer uses the module spec folder structure for its filters and
  can enable model previews.

## Preview and tune procedural sectors

Run `npm run tool:world-viewer` and open Vite's URL. Choose a seed and sector,
drag to pan, and scroll to zoom. Enable future sectors to inspect the full
catalog. Click a sector for fields, stations, wrecks, Jump Gates, and wormholes.
Zoom in to inspect asteroids from the region generator. Wormholes have their own
layer and dashed purple links. Dim Jump Gates lead to future sectors. Source
edits retain the seed, selection, camera, and layers. Generation runs in a
worker. Large views draw feature outlines and generate asteroids on zoom.

- Tune sector sizes, feature falloff, and gate placement in
  `src/specs/sectors.ts`. Tune field contents and feature spacing in
  `src/specs/region-generation.ts`.
- TypeScript and Rust generation accept an explicit sector context. Append
  names to the catalog. Sector IDs and seeds are derived from names. Preserve
  completed `graphStages` boundaries and append a boundary when adding a batch.
  Without a new boundary, new names attach individually at free sites. Existing
  graph edges and endpoints stay fixed during that expansion.
- Within a new batch the graph can add an endpoint when the seeded counts would
  leave a sector unreachable. The graph anchor and starting sector are separate
  settings. The initial enabled count controls which sectors are active.
- Jump Gates favor populated areas. Wormholes sample a wider annulus and may be
  the only route to a sector. Stations follow the same density and spacing
  rules, with none in sectors without Jump Gates. Nav beacons near active gates
  and scattered through sectors are currently inactive.
- Portal and arrival placement reserve space around connections. Use the
  viewers to inspect both departure and arrival sites. Tune each portal type
  in `src/specs/jump-gate.ts` or `src/specs/wormhole.ts` and shared travel
  timings in `src/specs/portal.ts`.
