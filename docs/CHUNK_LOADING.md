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

The standalone `npm run viewer` development entry lives under
`src/tools/game-object-viewer`. Its first frame statically loads the existing
object hierarchy and eagerly discovers ship, station and item specs with
Vite globs. It never loads the game entry, networking, prediction or audio
implementation. Fitted-module Fire buttons reuse ship firing and projectile
updates in an isolated preview world, with unlimited preview ammunition; the
preview craft stays stationary. This separate Vite configuration
does not add a production entry or change the game's loading triggers.

- Use a static import for code required before the first frame.
- Use `import()` only for a concrete later trigger.
- Add any new trigger to the table and verify a production build.

## Production contracts

The browser production build uses `plugins/build-plugins.ts`. Source rewrites
strip development flags, shorten internal client tags from `plugins/protocol-tags.ts`,
and mark app-owned properties from `plugins/property-names.ts`. The rewrite in
`plugins/replace-pre-terser.ts` skips quoted paths.

The build scans client and spec TypeScript exports and reserves their
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
consistently across two chunks. `npm run test snapshot server-integration`
measures real Go WebSocket packet sizes and checks that both source and
production-mangled client codecs acknowledge snapshots and receive input receipts. Keep the lazy boundary
intact in tests: bundling everything into one file masked the original
cargo-menu crash.

Ship/station binary field 34 optionally identifies a nondefault content spec.
The existing `definitionId`/`DefinitionID` field names remain part of the
serialization contract; they identify a spec. Existing fields and resource/module
IDs retain their values. Registry lookups
use maps or ordered arrays rather than dynamic property names.

Ship and item display names use the shared specs' `name` property. Clients
and restored server objects reconstruct these names from their content spec;
they need no additional snapshot field. The docked menu uppercases item names for
the current glyph set. Module display names also use `name`; the generic binary `label` field retains
its existing meaning.

Server UC control 6 carries the authoritative seven-bit paint unlock mask.
Persisted-session welcome frames append the same mask after the spawn position;
the decoder also accepts legacy welcome frames without that byte. These additions
do not change chunk loading triggers. Player tokens remain in localStorage, while
player profiles and world mechanics are stored by the Go server in SQLite.

Player balances append an optional float64 after the paint mask in UC welcome
and progress frames. The server sends the player account balance on joining
and after dock actions; the HUD and docked UI share the player object from
`src/client/player.ts`. That object owns a ships array, credits,
paint unlocks, visited station IDs, messages and HUD state. Its `ship` getter
returns the active ship in the first array entry; adopting a replicated or
respawned ship replaces that entry and retains other owned ships. UC messages apply
paint unlocks directly when received. Replacing the ship retains player state
without copying it onto the new ship. Balances are independent of ship prediction,
replacement and entity snapshots. UM field 2 remains reserved for legacy ship
credits; new snapshots omit it and the decoder consumes and discards it.
The existing chunk loading triggers are unchanged.

Shield generator sizes share the existing shield control and loading triggers.
The small generator uses module ID `shieldGeneratorSm` and retains index 7; medium
appends `shieldGeneratorMd` at index 8. Their bubble radii are 50 and 60,
respectively, in both client rendering and authoritative server collisions.

Single thruster sizes use the existing thruster renderer and loading triggers.
`thrusterSingleMd` retains index 0 and the original flare size of 7. Small,
large, and extra large append `thrusterSingleSm`, `thrusterSingleLg`, and
`thrusterSingleXl` at indices 9–11 with flare sizes of 5, 9, and 11. Their
flight stats are identical. Save restoration maps legacy `thrusterSingle`
IDs to medium and legacy `shieldGenerator` IDs to small.

Weapons use statically imported models, projectile rendering, and swept collision
checks in both client prediction and authoritative Go simulation. The client
predicts firing for its local player; remote shots arrive through replication.
Projectiles render above the scene's craft layers, using the sampled motion pose.
Plasma Accelerator and Autocannon append module indices 12 and 13. Autocannon ammunition appends
resource 5; each pack contains 200 rounds, and each shot consumes one round. Empty
packs are removed from cargo contents. Remaining rounds use optional UM field 35
and are preserved through prediction rollback and saved ships. The existing docked
chunk offers ammunition through dock action 6 (`buyAmmo`). Its loading trigger
is unchanged.

Holding Space fires both fitted weapons. Input bit 8 is carried in bit 1 of the
existing input flags byte; bit 0 still indicates an optional input offset.
Projectiles append entity kind 5 and use field 34 for their weapon spec.
Their health starts at weapon damage and decays over the configured lifetime;
the existing health field preserves this clock through snapshots and rollback. Module state mask bit 3 optionally
adds a firing cooldown after shades and before segment states, preserving cadence
through snapshots, rollback, and saved ships. Existing IDs and fields retain their
values. Client and server must be rebuilt together for these wire additions.

The Plasma Accelerator fires once every 2 seconds. Its optional module `recoil`
setting applies a backwards impulse per successful shot in both client
prediction and Go simulation. Recoil uses the normal mass-scaled force application;
the projectile inherits the ship's velocity before that impulse. Autocannon has
no recoil setting. This adds no snapshot fields or loading triggers.
Its three rectangular indicators in an outward-facing side recess
use the existing firing cooldown to return from shade 0 to shade 2 at 0.5,
1 and 1.5 seconds, adding no replicated state or loading trigger.

Weapon specs group speed, lifetime, radius and colour under `projectile`.
Its optional `glow` specifies an opaque colour, numeric alpha and a radius; omitting it disables
the halo. Clients and the Go server read the same nested catalog settings.
These spec fields add no binary snapshot fields or loading triggers.

Client module variants use the shared `Module.define(id)` method to bind their
specs to a behavior class and build its model. Weapons, thrusters, shield generators
and other modules use the same path and the existing shared constructor registry.
Wire indices, display order and loading triggers are unchanged.

Every module spec defines a `model` array. Each part chooses `outline: true`
for the normal edge stroke or `outline: false` for fill-only geometry; parts
can mix the two styles within one module. `color` selects the fill shade,
defaulting to shade 0. Decorative markings are independent of the edge stroke.
The shared client and Go model builders preserve the choice in detached and
replicated wreckage. Animated doors, flares, and shield covers keep their
behavior-specific geometry while taking their presentation from the model.
This adds no wire fields or loading triggers.

Every weapon model part is mirrored by its mount's side. Its optional `rechargeDelay`
and `rechargeColor` control recharge shading; `color` sets the charged shade.
Optional part `glow` settings specify radius, alpha and gradient stops as
`[offset, color, optionalAlpha]`; alpha is a number from 0 to 1, defaulting to 1.
Numeric colors select the module's paint
shade, while strings specify literal colors.
The Go server builds these models through the generic module constructor and
reads only their geometry and colour; recharge effects are client presentation.

Projectile impacts damage both the projectile and the contacted surface, so the
existing collision event records damage in both colours. On death, an optional
`projectile.explosion` supplies a radius, radial impulse and optional damage. Only Plasma Accelerator
opts in; Autocannon deals direct damage and emits its own impact sparks without
scanning or pushing nearby objects. The reusable `objects/explosion` implementation
in both clients and Go takes any source game object and blast settings, fading the
impulse with distance from each object's bounding surface and scaling it by mass.
An optional explosion `maxSpeed` caps the velocity increase before distance falloff.
Plasma uses a 1,200-unit impulse capped at 32 units/second. Before distance
falloff, a mass-300 chunk gains 4 units/second and light items gain 32 units/second.
Very heavy fragments can fall below the existing 1-unit/second stopping threshold.
Blast damage uses actual collider shapes and damages each hull segment, asteroid segment
or fitted module once. The directly contacted surface is excluded from splash damage
because it already received the hit. Asteroid segments broken by the same blast detach
together; their new fragments and items receive force without a second damage pass.
Autocannon emits own-colour sparks on impact and gameplay expiry. Plasma uses
its dedicated explosion instead: presentation suppresses generic sparks for the
explosion source in the same event batch, preserving target sparks. Timed
expiry uses the optional death event supplied by an object to the movement
scheduler, so it remains independent of the area effect. Plasma expiry also
applies its configured area damage and impulse; replication cleanup emits neither effect.
Merged snapshot corrections replay retained older checkpoints even when the newest
tick has no checkpoint, preserving damage and impulses across delayed browser frames.
Render corrections also retain the displayed asteroid outline. Server allocations
outside a player's interest set can shift speculative fragment IDs; an authoritative
fragment with a different outline discards the previous fragment's pose correction,
even when their kinds and radii match. Coordinate differences below 1e-6 retain
normal smoothing to allow geometry rounding between Go and the browser.
These settings add no wire fields or loading triggers.

An optional explosion `effect` is an ordered array of visual layers: polygons,
rings and glows. The client-owned `EffectSpec` and `EffectLayer` types live
beside the generic player in `src/client/effects/effect.ts`; the module schema
references them through a type-only import, with no runtime client dependency.
Each layer specifies colour, radius and duration, with optional delay, numeric
alpha and `fadeDuration`. All timing uses milliseconds. `fadeDuration` fades
opacity over the final portion of a layer's lifetime; omitting it keeps opacity
constant. Optional `scale: [start, end]` animates any shape, defaulting to a
constant scale of one. Numeric `easeOut` sets the easing exponent; `2` is
quadratic, and omitting it keeps interpolation linear. Easing applies to scale and animated polygon corners,
independently of fading, thinning and dissolving.
Polygon `pointCount` specifies tips and `radiusEven` the alternate corner radius,
in the same units as `radius` (default `radius / 4`). A `[start, end]` pair
animates those alternate corners, keeping the outer tips and random variation
stable. Matching starting geometry shares normalized points and a static path
per effect, including layers with different radii. Animated polygons rebuild
only their path from those points; they never reroll the geometry. Optional polygon `dissolveDuration` clears
the centre outward during the final part of its lifetime, clipping the fill to
the current outline so underlying scenery remains intact. Rings have optional `lineWidth` and
`endLineWidth`; width changes linearly, independently of scale and opacity.
Omitting them uses a constant object outline width. Zero-width rings do not draw.

`addEffect` snapshots the position and accepts optional rotation and overall
scale; rotation defaults to random and scale to one. Total lifetime is calculated
at spawn, including delayed layers. `src/specs/effects/plasma-explosion.ts`
uses five layers: a short black contrast flash, a shrinking pale core, an
expanding violet shell that dissolves from the centre, a glow, and a ring that
starts near the impact point and expands while fading and thinning to zero. The bright
layers begin after the black contrast flash. The stars start pointed and soften
as they expand; the violet shell also fades during its final 80 ms. Longer
expansion durations use proportionally higher easing exponents to retain the
initial expansion speed and slow the later motion. The glow keeps its initial
80 ms at full opacity, then fades over 230 ms, ending the whole effect at 342 ms.
Only the glow uses a gradient.
The generic effect renderer is statically loaded with the main client. Gameplay
still emits a local explosion presentation event; only normal event presentation
creates the visual, so prediction replays do not duplicate it. Visual age advances
once per rendered frame, before new events are presented. Frame seconds convert
to milliseconds when updating effects and sparks; spark movement retains
velocities in units per second. These settings require no Go implementation,
binary fields or new lazy chunks.

All visual opacity settings, including item, module and docking-bay `fillAlpha`,
use numbers from 0 to 1. The shared client `utilities/color` helper `withAlpha`
converts an opaque hex colour and numeric alpha to a canvas colour. It is also
statically included in the inline background renderer and docked chunk;
their loading triggers are unchanged.
