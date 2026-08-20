# Collision and cargo scoop plan

## Goals

- Every game object and component that has collision geometry participates in contact detection.
- Every nearby collider pair is tested once.
- Colliders belonging to the same assembled body do not collide with one another.
- Contact detection and physical response are separate. A collider always reports contacts, while a single boolean decides whether it has physics.
- Anything with physics follows the same mass, velocity, bounciness and positional-correction rules.
- Cargo scoop geometry and collection remain owned by the installed cargo scoop.
- Each cargo scoop controls only its corresponding opening in the ship's hull.
- Ship and station mounts are nested in the hull segments that structurally support them.
- Modules can either share their parent hull segment's health or retain independent health.
- The cockpit module is removed entirely.

## Terminology

A **body** is an independently moving thing, such as a ship, asteroid or loose item. A station is also a body, but is fixed in place.

A **collider** is a circle or polygon that can report overlaps. Simple bodies such as items and asteroids can be their own collider. Compound bodies such as ships and stations have a collider for each hull segment or module part.

Every collider detects contacts. A collider with physics enabled is solid and participates in physical response. A collider with physics disabled is commonly called a sensor: it still reports exactly the same contact, but no velocity or position correction is applied.

This should be represented by one boolean, probably `physics`. There should not also be a `sensor` type or a string-valued collision category:

```js
{
  body,
  physics: true,
  radius,
  outline,
  x,
  y,
}
```

`physics` should default to `true`. Sensor-like colliders opt out with `physics: false`.

## Current behaviour

### Collision detection

Loose items, asteroids and station hitboxes are placed in the spatial grid. Ships generate temporary hitboxes and query the grid while each ship moves.

Only ships request and resolve general world contacts. Item-item, item-station and asteroid-asteroid overlaps are valid according to the detector, but are not processed because neither side asks for them.

The existing detector excludes two pieces when both share the same `owner`. This prevents a ship's hull segments and modules from colliding with their siblings, but collision ownership is mixed together with physical-body ownership.

### Physical response

`src/resolve.js` is ship-specific. It decides whether to move the ship or the other object, combines their bounciness, ignores non-physical scoop throats and docking pieces, and contains the cargo-opening exception.

Loose objects do not run this resolver themselves. Consequently, items do not collide physically with other items or stations.

### Cargo scoop construction

`src/modules/cargo-scoop.js` defines three parts:

- Two animated, physical doors.
- One invisible throat with `catches: true`.
- A throat radius that becomes non-zero only after the scoop is sufficiently open.

This is the correct ownership: without an installed and functioning scoop, a ship should have no doors or throat capable of collecting cargo.

`src/ships/mustang.js` separately marks two hull segments with `mouth: true`, while its cargo scoops live in a separate ship-level `mounts` array. The relationship between each scoop and one of those hull segments is therefore implicit.

The same split applies to every module: hull geometry is in `hullSegments`, while structural mounting information is kept separately in `mounts` even though every mount belongs to a particular part of the hull.

The Mustang's nose hull segment currently pretends to contain a shapeless `cockpit` module. The cockpit contributes a name, price and `critical` flag but no geometry of its own. It should not remain a module.

### Cargo opening physics

`src/resolve.js` searches the entire ship for any healthy cargo-scoop segment whose animation exceeds `scoopOpen`. If it finds one, it skips item physics for every hull segment marked `mouth`.

This means opening either Mustang scoop makes both hull openings non-physical to items. Destroying one scoop also cannot reliably restore only its own opening because mounts do not retain their generated segments or a reference to their corresponding hull segment.

The two scoop mounts also share the same reusable `cargoScoop` definition object. Their doors and throats become separate segments, but there is no installed-module object grouping the three parts at one mount or associating that installation with its supporting hull segment.

### Cargo collection

During each ship movement step, `src/ship.js` collects contacts and passes the same list to:

1. `src/scoop.js` for cargo collection.
2. `src/mining.js` for horn contacts.
3. `src/resolve.js` for physical response.

`src/scoop.js` accepts a contact when the other collider is an item and the ship collider belongs to a `catches` segment. It then checks that the item's centre is inside the throat radius.

Credits are awarded immediately, messages are read immediately, and ordinary items are placed in the player's hold when there is room. A collected item is removed from both the loose-item list and spatial grid.

The throat still produces a collision contact but receives no physics, so it notices an item without pushing it away. That behaviour should be preserved using `physics: false`.

## Target collision model

### Unified crafts

Ships and stations are data categories backed by the same `Craft` runtime object. Every craft can fit modules, carry cargo, move under thrust, host or enter docking regions, carry nearby bodies, take damage and render segments on global z-index layers. A missing capability needs no type check: without thrusters it cannot accelerate, without a `docks` segment it cannot host docking, and without `localMovementRadius` it neither carries nearby bodies nor draws a range ring.

Craft definitions do not contain installed modules or initial cargo. Every craft starts with an empty `cargo` array; a missing `cargoSpace` means unlimited room. A missing `mass` gives zero inverse mass, so collisions, explosions and local movement cannot displace that craft. Hull gradients are selected by `hullGradient`, while ship and station definitions may remain in separate folders for organization.

### Bodies and colliders

Every world body exposes one or more persistent colliders:

- An item or asteroid can use itself as its collider.
- A craft has one collider for each active hull segment and module part.
- A destroyed or removed component removes or disables its collider.

Each collider refers to its physical body. Segment colliders additionally retain their segment and installed-module references so gameplay systems can identify what was touched.

Craft colliders are persistent. Their position, rotation, animated outline, radius and physics flag are refreshed when the craft or segment changes.

### Hull segments and nested mounts

The top-level `mounts` arrays should be removed from ship and station definitions. A hull segment instead contains the mounts structurally attached to it:

```js
{
  health: 20,
  mounts: [
    { fits: [cargoScoop], x: 3, y: -13 },
  ],
  points: [...],
}
```

Mount coordinates remain in ship space. Nesting expresses ownership and health relationships only; it must not cause the mount's `x` and `y` to be translated relative to the hull segment. Existing drawing and collider transforms should continue to apply the mount coordinates directly from the ship origin.

Definitions contain only empty mount slots, and `fits` is always an array. Demo, shop or saved-game code chooses a craft's loadout after constructing it. Construct each hull segment first, then copy its empty mounts with direct `hull` references. Fitting a module later creates that installation's parts. A body may still keep flat derived lists of all mounts and segments when convenient for fitting, controls, searches, rendering or collisions, but its definition has one source of truth: the nested mounts.

For the Mustang layout:

- Each cargo scoop mount moves inside the hull segment that forms its opening.
- The horn and floodlight mounts move inside the nose hull segment currently occupied by the cockpit.
- The thruster and shield mounts move inside the rear-centre hull segment.
- Mount coordinates keep their current ship-level values.

The Corral's docking-bay mount should likewise move inside the station hull segment that structurally contains its socket. Its coordinates remain station-level coordinates.

### Removing the cockpit

Delete the cockpit module definition, export and imports. Remove `module: cockpit` from the Mustang hull.

Remove the cockpit's `critical` behaviour and all resulting `critical` and `destroyed` fields and branches. Destroying the nose hull segment should damage only that segment and anything sharing its health; it should not automatically destroy the whole ship. Hull segments and modules remain independently damageable through their ordinary health targets.

The floodlight and horn remain ordinary installed modules nested under that hull segment. Removing the cockpit must not merge either module's geometry, controls or health into a replacement cockpit object.

### Fixed physics ticks and movement hops

Rendering and simulation are different clocks. Kontra renders through `requestAnimationFrame`, so rendering may run at 60, 90, 120 or another monitor refresh rate. Its `GameLoop` already uses an accumulator and calls `update(dt)` at a fixed rate of 60 Hz by default. The collision rework should keep that fixed 60 Hz simulation and must not add a second frame accumulator.

In this plan, a **render frame** means one browser repaint, a **physics tick** means one fixed 1/60-second `update`, and a **physics step** or **movement hop** means one anti-tunnelling subdivision inside that physics tick.

For each physics tick:

1. Update controls, timers and other non-positional state once.
2. Start with the fixed tick's full amount of time remaining.
3. Before each movement hop, validate stored carriers and find the greatest ordinary, carried or rotational speed currently affecting any collider.
4. Choose a shared step no longer than the remaining time and small enough to keep that greatest displacement within `maxHop`.
5. Move every body for that step, apply carried movement, refresh compound colliders, generate contacts and resolve physics.
6. Repeat until no time remains in the fixed tick.
7. Perform post-physics gameplay work after the last hop.

Every collision-capable body uses the same steps. There is no ship-only movement or collision schedule. Contacts are generated at most once per collider pair per physics step, rather than once per rendered frame or physics tick.

### Carried movement

A body already stores its current carrier in `localMovementParent`; the state-update phase does not need to select or calculate a new parent in advance.

During movement, first look up that stored parent and check whether it still holds the body. If it does, use it directly. If it no longer does, release the body and search the small `movers` list for a replacement. A body without a stored parent also searches that list so it can enter a road or station.

This membership check should happen before each shared movement hop, because a body may cross into or out of a road or station part-way through a physics tick. The carrier's existing `momentum(body)` supplies its carried speed when choosing the next step, while `carry(body, step)` applies the movement for that hop. Recalculating the next step from the current carrier state prevents a body that has just entered a fast road from taking one oversized carried step.

### Unique world pairs

The world collision phase should:

1. Update every collider's world transform and current physics flag.
2. Place all active world colliders in the spatial grid.
3. Visit each nearby collider pair once.
4. Skip the pair when both colliders belong to the same body.
5. Run the existing exact circle/polygon overlap test.
6. Produce one contact containing both colliders, both bodies, overlap depth and separation direction.
7. Give that contact to gameplay handlers and the generic physics resolver.

Pair uniqueness should be based on stable collider identity or insertion order. It should not depend on which body happened to query the grid first.

Contact generation only reports overlap. It never applies damage. A later impact-damage feature may consume a physical contact and relative impact speed, but that remains separate from collision detection and resolution.

### Assembly exclusion

The exclusion rule should compare physical bodies:

```js
if (a.body === b.body) return;
```

This excludes:

- Hull segment against sibling hull segment.
- Ship module against another part of the same ship.
- Station module against its station hull.
- Any other two colliders belonging to one assembled body.

It does not exclude:

- Components belonging to different ships or stations.
- Two loose items.
- Two items buried in the same asteroid, because each item remains its own physical body.

The asteroid is the buried items' transform container, not their collision body or collision owner.

### Shield coverage

Shield coverage should be handled while evaluating a candidate pair, without removing or deactivating all underlying ship colliders. If a collider belongs to a ship whose shield bubble is active, skip that collider unless it is the active covering shield collider itself.

This keeps the ship's ordinary colliders available for their usual construction and updates while ensuring an external asteroid, item, ship or station can contact only the active shield. Colliders belonging to the same ship are already excluded by the same-body rule.

## Generic physics

The resolver should accept an ordinary contact rather than a ship and a ship-shaped contact list.

If both colliders have `physics: true`, resolve the contact using their bodies' common physical properties:

- Position and velocity.
- Mass, with zero inverse mass when it is undefined.
- Bounciness.
- The existing overlap slop, correction limit and easing.

When both bodies can move, velocity and positional response should be divided according to inverse mass. This naturally produces item-item response, lets items bounce off stations, and lets differently sized bodies affect one another without object-type branches.

Movable bodies provide mass and bounciness. Undefined mass deliberately makes a body immovable by other objects.

If either collider has `physics: false`, the contact is still reported but the generic resolver does nothing. Gameplay handlers may still consume it.

## Installed modules and scoop openings

### Installed module identity

A reusable module definition describes what can be fitted. Each occupied mount should represent one installed module and retain the segments produced for that installation:

```js
mount.module
mount.segments
mount.hull
```

The controls may still toggle every installation of the same module definition together. Physical state and damage must nevertheless be traceable to the individual mount.

This allows the game to answer whether one particular scoop is present, healthy and open, and which doors and throat should disappear when it is removed.

### Linking a scoop to its hull panel

The nested layout provides the link without an index or a separate `mouth` property. A cargo scoop's parent hull segment is its opening:

```js
{
  health: 20,
  mounts: [{ fits: [cargoScoop], x: 3, y: -13 }],
  points: [...],
}
```

The reusable cargo scoop still does not know anything about a particular ship's hull. When one is fitted, its occupied mount already has a direct `hull` reference because the empty slot came from inside that hull segment. The standalone `mouth: true` properties can be removed.

### Opening and closing

There is no special "item opening" collision category.

The linked hull panel is an ordinary collider whose `physics` boolean changes with its installed scoop:

- Closed or not sufficiently open: `physics: true`.
- Open beyond `scoopOpen`: `physics: false`.
- Closing back below `scoopOpen`: `physics: true` again.
- Scoop destroyed or removed: `physics: true`.

Detection remains enabled in every state. When open, the panel can still report that an item or another object overlaps it, but it applies no physical response to anything. The switch at `scoopOpen` is binary even though the animation is continuous; there is no intermediate collision state.

The two animated scoop doors remain ordinary physical colliders. The invisible throat always has `physics: false`, and its radius remains zero until the scoop is open enough to collect cargo.

## Damage and shared health

Collision detection should report which collider was hit, but it should neither cause damage nor decide where damage is stored. A separate damage-producing system chooses an amount, and each damageable collider or segment refers to the target that receives it.

A hull segment with health uses it; one without health is indestructible. A mounted module with a `health` value uses its existing independent module or part health. A mounted module without a `health` value shares its parent hull segment's health. If that hull also has no health, both are indestructible. Health below one is destroyed and inactive; damage is not clamped to exactly zero. No `sharesHealth` flag is needed.

For a shared-health installation:

- Every module-part collider points to the parent hull segment as its damage target.
- A hit on the module reduces the hull segment's health.
- A hit on the hull segment reduces that same health.
- The module's availability, animation and colliders depend on that shared health.
- When the hull segment reaches zero, all shared-health modules nested in it stop functioning and their colliders are disabled or removed.
- The module does not maintain a second health pool.

For an independent-health installation:

- Module-part colliders keep their own damage targets and health.
- Damage to the module does not reduce the parent hull segment's health.
- Damage to the hull segment does not reduce the module's health.
- Destroying the hull segment does not implicitly spend the module's hit points, although a later ship-breakup system may detach or remove modules structurally.

The Mustang should use these relationships:

- Remove `health` from cargo scoops so they share health with their parent opening hull segments.
- Remove `health` from the floodlight so it shares health with the nose hull segment.
- The horn retains independent health.
- The shield retains independent health.
- The thrusters retain their current independent health unless their design is changed separately.

This means shooting either a scoop door or its opening damages one hull health pool. Likewise, damaging the nose hull also damages the floodlight because both read the same pool. Shooting the horn or shield damages only that module's own pool.

The health relationship is independent of collision and physics state. A collider can detect a hit with `physics: false`, and its damage target can still decide whether that contact causes damage. Conversely, sharing health does not make a module and hull collide with one another because both colliders still belong to the same ship body.

## Cargo collection after the rework

The cargo throat remains part of `cargoScoop` and remains marked `catches`. That is gameplay metadata, not a collision category.

For a contact between an item and a non-physical throat:

1. The world pair pass reports the contact normally.
2. The scoop handler identifies the throat's installed module and owning ship.
3. It confirms that the installation is healthy and sufficiently open.
4. It confirms that the item's centre is inside the throat radius.
5. It asks the owning ship or pilot whether there is cargo room.
6. Credits and messages apply their immediate effects; ordinary cargo is stowed.
7. A collected item is removed from the world list and collision grid.

Removing a scoop removes its doors and throat collider, so that side of the ship can no longer collect cargo. Because a scoop shares its parent hull's health, the complete scoop installation stops functioning when that health reaches zero; its individual doors and throat do not have competing health pools.

## Contact consumers

Contact detection should not import cargo-scoop thresholds or decide gameplay outcomes. After unique contacts are generated, they should be made available to:

- The generic physics resolver.
- Cargo collection for scoop-throat contacts.
- Mining for horn contacts.
- Docking for the station centre-segment contact.
- Future damage or trigger systems.

The same contact can be useful to gameplay while producing no physical response. Scoop throats and docking regions are the main examples.

These consumers should move out of the ship-only collision loop. That lets item-item and item-station physics occur without adding collision queries to every object class.

## Docking after the rework

Docking uses the same craft contacts as every other interaction. The Corral's centre hull segment remains a collider but has `physics: false`, allowing another craft to overlap it.

Mark that specific centre segment as the docking target. If any collider belonging to a non-launching craft contacts it, the guest is docked to the target's owning craft. When there is no such contact, it is no longer docked. Ignoring launching crafts prevents one placed at the host's centre for launch from immediately docking again.

The docking-bay geometry can remain non-physical so ships can pass through it, but it no longer decides whether docking has completed. The centre hull contact alone is the docking condition. Launching and station-carried movement continue to use `ship.dockedTo` as they do now.

## Buried asteroid contents

Buried items remain outside the world spatial grid, so they cannot collide with external objects through the asteroid shell.

Their local collision pass should use the same unique-pair generation and generic resolver without assigning the asteroid as their common body:

1. Put the children into asteroid-local coordinates.
2. Generate each child pair once.
3. Resolve pairs whose colliders have physics enabled.
4. Preserve their resulting local positions.
5. Transform them by the asteroid's world translation and rotation for rendering and eventual release.

This preserves item-item collisions inside each asteroid while sharing the same physical rules as loose items.

## Implementation sequence

1. Move ship and station mounts into their parent hull-segment definitions while preserving body-space coordinates and sharing their construction code.
2. Remove the cockpit module and all critical/destroyed code while preserving ordinary hull and module damage.
3. Give each fitted module an installation identity through its mount and retain its parent hull and generated segments.
4. Infer shared health from missing module health for cargo scoops and the floodlight while preserving independent horn, shield and thruster health.
5. Introduce the collider/body/physics shape without changing existing gameplay.
6. Make ship hitboxes persistent and attach ship/station segment colliders to their bodies.
7. Keep Kontra's fixed 60 Hz updates and replace per-object movement with shared anti-tunnelling movement hops.
8. Generate unique world contact pairs per physics step and replace the same-owner exclusion with a same-body exclusion, including active-shield filtering.
9. Generalize `resolve.js` to resolve any two physical bodies by mass and bounciness.
10. Move world collision processing out of `Ship.update()` and enable item-item and item-station physics.
11. Toggle each cargo-opening hull collider's physics from the cargo scoop nested directly inside it.
12. Route scoop-throat contacts to cargo collection without involving the physics resolver.
13. Route horn contacts and centre-segment docking contacts through the same contact output.
14. Replace asteroid-specific pair handling with the shared pair generator and resolver in local coordinates.
15. Remove obsolete ship-only contact orchestration, global mouth searches and duplicated special cases.

Each step should preserve a playable build and include focused checks for the behaviour introduced at that step.

## Behaviour checks

- Two loose items collide and separate.
- A loose item collides with a station's solid hull.
- An item overlapping a non-physical collider still produces a contact.
- Ship and station siblings never collide with their own body.
- Components belonging to different bodies do collide.
- Contact detection alone never damages either body.
- An active shield prevents contacts with its ship's underlying colliders.
- Rendering at different monitor refresh rates does not change simulation speed or physics results.
- Fast ships, items and carried bodies cannot tunnel through thin colliders.
- A body keeps using its stored local-movement parent while that parent still holds it.
- A body entering or leaving a road or station updates its stored parent during movement hops.
- Opening the upper scoop changes only the upper linked hull opening.
- Opening the lower scoop changes only the lower linked hull opening.
- A closed, destroyed or removed scoop leaves its hull opening solid.
- Nested mounts retain their existing ship-space positions.
- Station mounts use the same nested structure and construction path as ship mounts.
- No cockpit module remains; the nose hull segment remains as hull geometry.
- Destroying the nose hull segment does not automatically destroy the ship.
- Damage to a cargo scoop reduces its parent hull segment's health, and vice versa.
- Damage to the floodlight reduces its parent hull segment's health, and vice versa.
- Damage to the horn does not reduce its parent hull segment's health, or vice versa.
- Damage to the shield does not reduce its parent hull segment's health, or vice versa.
- Thruster health remains independent of its parent hull segment.
- An open scoop throat detects and collects an item without pushing it.
- A ship without a functioning scoop throat cannot collect cargo.
- A full cargo hold leaves an item in the world and collision grid.
- Contact with the Corral's non-physical centre hull segment docks a ship.
- Contact with docking-bay geometry alone does not dock a ship.
- A launching ship does not redock while it is leaving the station centre.
- Horn contacts still mine asteroids.
- Buried items collide with one another but not with objects outside their asteroid.
- Buried items inherit both asteroid translation and rotation.
