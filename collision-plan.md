# Collision and cargo scoop plan

## Goals

- Every game object and component that has collision geometry participates in contact detection.
- Every nearby collider pair is tested once.
- Colliders belonging to the same assembled body do not collide with one another.
- Contact detection and physical response are separate. A collider always reports contacts, while a single boolean decides whether it has physics.
- Anything with physics follows the same mass, velocity, bounciness and positional-correction rules.
- Cargo scoop geometry and collection remain owned by the installed cargo scoop.
- Each cargo scoop controls only its corresponding opening in the ship's hull.
- Ship mounts are nested in the hull segments that structurally support them.
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

### Bodies and colliders

Every world body exposes one or more persistent colliders:

- An item or asteroid can use itself as its collider.
- A ship has one collider for each active hull segment and module part.
- A station has one collider for each active hull segment and module part.
- A destroyed or removed component removes or disables its collider.

Each collider refers to its physical body. Segment colliders additionally retain their segment and installed-module references so gameplay systems can identify what was touched.

Ship colliders should become persistent like station colliders instead of being recreated for every query. Their position, rotation, animated outline, radius and physics flag are refreshed when the ship or segment changes.

### Hull segments and nested mounts

The top-level `mounts` array should be removed from ship definitions. A hull segment instead contains the mounts structurally attached to it:

```js
{
  health: 20,
  mounts: [
    { fits: [cargoScoop], module: cargoScoop, sharesHealth: true, x: 3, y: -13 },
  ],
  points: [...],
}
```

Mount coordinates remain in ship space. Nesting expresses ownership and health relationships only; it must not cause the mount's `x` and `y` to be translated relative to the hull segment. Existing drawing and collider transforms should continue to apply the mount coordinates directly from the ship origin.

`Ship` should construct each hull segment first, then construct that segment's mounts and installed module parts. Each runtime mount retains a direct `hull` reference to its parent segment. The ship may still keep a flat derived list of all mounts when convenient for fitting, controls or searches, but the ship definition has one source of truth: the nested mounts.

For the Mustang layout:

- Each cargo scoop mount moves inside the hull segment that forms its opening.
- The horn and floodlight mounts move inside the nose hull segment currently occupied by the cockpit.
- The thruster and shield mounts move inside the rear-centre hull segment.
- Mount coordinates keep their current ship-level values.

### Removing the cockpit

Delete the cockpit module definition, export and imports. Remove `module: cockpit` from the Mustang hull.

Remove the cockpit's `critical` behaviour as well. Destroying the nose hull segment should damage only that segment and anything sharing its health; it should not automatically destroy the whole ship.

The floodlight and horn remain ordinary installed modules nested under that hull segment. Removing the cockpit must not merge either module's geometry, controls or health into a replacement cockpit object.

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

## Generic physics

The resolver should accept an ordinary contact rather than a ship and a ship-shaped contact list.

If both colliders have `physics: true`, resolve the contact using their bodies' common physical properties:

- Position and velocity.
- Mass, or fixed/zero inverse mass for an immovable body such as a station.
- Bounciness.
- The existing overlap slop, correction limit and easing.

When both bodies can move, velocity and positional response should be divided according to inverse mass. This naturally produces item-item response, lets items bounce off stations, and lets differently sized bodies affect one another without object-type branches.

Every solid body must therefore provide mass and bounciness. Constructors should supply compact defaults where a whole class shares values, such as all ordinary items. Stations should explicitly behave as fixed bodies rather than relying on a missing velocity or mass.

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
  mounts: [{ fits: [cargoScoop], module: cargoScoop, sharesHealth: true, x: 3, y: -13 }],
  points: [...],
}
```

The reusable cargo scoop still does not know anything about a particular ship's hull. At runtime, its installed mount already has a direct `hull` reference because it was created from inside that hull segment. The standalone `mouth: true` properties can be removed.

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

Collision detection should report which collider was hit, but it should not decide where damage is stored. Each damageable collider or segment should refer to its damage target.

By default, a hull segment uses its own health and a mounted module uses its existing independent module or part health. A nested mount can opt into the parent hull's health with one boolean such as `sharesHealth: true`.

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

- Cargo scoops share health with their parent opening hull segments.
- The floodlight shares health with the nose hull segment.
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
- Docking for station opening contacts.
- Future damage or trigger systems.

The same contact can be useful to gameplay while producing no physical response. Scoop throats and docking regions are the main examples.

These consumers should move out of the ship-only collision loop. That lets item-item and item-station physics occur without adding collision queries to every object class.

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

1. Move ship mounts into their parent hull-segment definitions while preserving ship-space coordinates.
2. Remove the cockpit module and its critical ship-destruction behaviour.
3. Give each fitted module an installation identity through its mount and retain its parent hull and generated segments.
4. Add explicit shared-health damage targets for cargo scoops and the floodlight while preserving independent horn, shield and thruster health.
5. Introduce the collider/body/physics shape without changing existing gameplay.
6. Make ship hitboxes persistent and attach ship/station segment colliders to their bodies.
7. Generate unique world contact pairs and replace the same-owner exclusion with a same-body exclusion.
8. Generalize `resolve.js` to resolve any two physical bodies by mass and bounciness.
9. Move world collision processing out of `Ship.update()` and enable item-item and item-station physics.
10. Toggle each cargo-opening hull collider's physics from the cargo scoop nested directly inside it.
11. Route scoop-throat contacts to cargo collection without involving the physics resolver.
12. Route horn and docking contacts through the same contact output.
13. Replace asteroid-specific pair handling with the shared pair generator and resolver in local coordinates.
14. Remove obsolete ship-only contact orchestration, global mouth searches and duplicated special cases.

Each step should preserve a playable build and include focused checks for the behaviour introduced at that step.

## Behaviour checks

- Two loose items collide and separate.
- A loose item collides with a station's solid hull.
- An item overlapping a non-physical collider still produces a contact.
- Ship and station siblings never collide with their own body.
- Components belonging to different bodies do collide.
- Opening the upper scoop changes only the upper linked hull opening.
- Opening the lower scoop changes only the lower linked hull opening.
- A closed, destroyed or removed scoop leaves its hull opening solid.
- Nested mounts retain their existing ship-space positions.
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
- Docking detection still works through non-physical station colliders.
- Horn contacts still mine asteroids.
- Buried items collide with one another but not with objects outside their asteroid.
- Buried items inherit both asteroid translation and rotation.
