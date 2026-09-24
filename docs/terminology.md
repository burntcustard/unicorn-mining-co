# Terminology

**asteroid** - A rock made of destructible segments. It may contain resources that become items.

**asteroid segment** - One destructible piece of an asteroid, with its own shape, health, and contents.

**cargo** - Things carried inside a craft. Always clarify with an additional term, for example to refer to a craft's contents, capacity, or entry point.

**cargo contents** - The collection of game objects carried inside a craft, including items and spare modules.

**cargo hatch** - A door or scoop module through which objects are collected into cargo.

**cargo space** - The maximum number of game objects a craft can carry in its cargo.

**collider** - A shape used to detect when game objects touch. One object can have several colliders.

**contact** - A recorded touch or overlap between two colliders. It can trigger a collision, docking, drilling, or collecting an item.

**craft** - An object built from hull and module segments, such as a ship or station. Broken-off craft fragments use the same structure.

**docking** - A ship entering a station's docking bay and becoming attached to that station.

**drill tip** - A small nonphysical collider at the horn drill's point. Only its contacts can cause drilling damage.

**drilling** - What happens when damage is dealt by an active horn drill through contact at its drill tip.

**entity** - A game object currently present in the world. Objects stored inside cargo need not be world entities.

**game object** - Anything in the game with its own identity and state, such as a craft, asteroid, item, or module.

**health** - The remaining strength or 'hitpoints' of a game object or one of its pieces. Damage reduces a game objects health.

**hitbox** - One or more colliders used to detect collisions for a game object.

**horn drill** - A pointed drill module fitted to a craft.

**hull** - The structural body of a craft, made from hull segments rather than fitted modules.

**hull segment** - One structural piece of a craft's hull. It has its own shape and health and may carry a mount.

**input frame** - The controls held at the start of a simulation tick, together with any changes during that tick.

**interior light** - Light visible inside an asteroid where a search light beam passes through it. It illuminates that slice of rock and reveals buried items there.

**item** - A collectible game object, such as a gem or message.

**light beam** - The visible cone projected by an active search light, from its lens to the first asteroid it meets or the end of its reach.

**local position** - A location measured from a craft's centre, used for its mounts and segments.

**model** - The plan for a module's shape, made from one or more segments. A segment in the model may use points to describe its shape.

**module** - A functional or decorative part of a craft. It can be fitted to a mount or carried in cargo.

**module segment** - One piece of a fitted module's shape. A module can have several segments attached through one mount.

**module state** - A description of a module's current condition, including whether it is fitted and how its parts are behaving.

**mount** - A location on a craft where a module can be fitted. The mount is the fitting location rather than the module itself.

**outline** - A sequence of points tracing the edge of a shape.

**paint** - A choice of colour scheme for a craft or module.

**player** - A participant in the game, associated with a ship. The player and ship are separate things.

**player input** - The controls a player uses to fly a ship or operate its modules.

**point count** - The number of points used to form a shape, such as an asteroid's outline.

**points** - The places marking the corners of a shape, usually in order around its outline. In a model, points can give a segment its shape.

**position** - A game object's location in the world.

**prediction** - The client's estimate of what happens after player input, before the matching server update arrives.

**region** - A square part of the world used to generate and load nearby asteroids, stations, and wrecks.

**region description** - A plan for the asteroids, stations, and wrecks in a region before they appear as objects in the world.

**replication** - Sending relevant game object state from the server to a client.

**resource** - A numbered kind of item or asteroid material. Resources inside an asteroid determine which items it can release.

**search light** - A module that projects a light beam ahead of a craft.

**segment** - One piece of a larger object. Kinds of segments include: asteroid segment, hull segment, module segment.

**shades** - The colours used to draw a craft or module, including its fill, outline, shadow, and highlight.

**shield generator** - A module that projects a protective shield around a craft.

**ship** - A craft that can fly when intact and dock at a station. A ship may belong to a player.

**snapshot** - A server update describing which objects are in a player's view and the current state of some of them.

**spectrum** - The rainbow of coloured light projected from the far side of an asteroid when a search light beam passes through it.

**station** - A craft with docking bays that can receive ships.

**thruster** - A module used to propel a craft.

**flare** - A visual effect that expresses craft thrust. A thruster flare may appear larger, smaller, or not be visible at all, depending on its associated thruster's activation status.

**tick** - One fixed step of the game simulation.

**world** - The running simulation and its current game objects, players, and tick.

**wreck** - An abandoned ship found in a region, potentially with cargo. The wreck is the whole ship.

**wreckage** - Loose pieces broken off a craft after damage, rather than a whole wreck.
