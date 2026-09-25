# TODO

## High priority

[x] Fix drilling particles coming from center of drill not contact point
[x] Fix things being slipperier than they should be, like the horn drill
[x] Combine Plank.js code with ours better, e.g. remove duplicate vector
[x] Fix internal light or other players not revealing items

## MVP

[x] Native websockets front-end
[x] Native Node.js back-end
[x] Swap to full TypeScript
[x] Remove roadroller and ZIP compression
[x] Code-splitting to load different JS files first
[ ] PWA-ish stuff like webmanifest
[x] Remove unecessary docs like build-size-breakdown.md
[x] Remove active roadroller/zip build tooling
[ ] New full test suite
[ ] Rethink update area ratios and timings
[ ] Better benchmarking FPS test suite
[ ] Rethink sound, perhaps more ZzFX-ey
[ ] Remove auto-approve things in .vscode/settings.json
[ ] Figure out if there's anything else we can remove
[ ] Re-split ship and stations
[ ] New items, unique values and health
[-] Collisions with rotation physics
[ ] Figure out new hull/mounting-points relationship
[ ] New UI v1
[ ] Rewrite keyboard handler with full key strings
[ ] Better text demo
[ ] Create lower case versions of A-Z
[ ] Create more symbols
[ ] Add characters for lowercase and special chars
[ ] Neaten up files, especially player.ts & vector.ts
[ ] Better non-debug-only FPS counter with memory usage etc.
[ ] Refine module (mount?) categories like thrusters
[ ] More modules.
[ ] Fix floodlight not revealing along its edge pixels
[ ] Smoothly move camera to center of station again
[ ] Ensure tests aren't overlapping with each other
[ ] Swap 'FIX' with 'REPAIR' or 'Repair'
[ ] Fix colors unlocked not saving on reconnect

## Big future things

[ ] New UI v2
[ ] Roads
[ ] Map
[ ] New ships
[ ] New space stations, with more than 1 docking bay
[ ] Flashy dots near docking bays
[ ] Explosives
[ ] New particle engine with batches
[ ] New achievement system
[ ] Ship decals
[ ] New graphics like concept art
[ ] Redo outline.js with different colors and stuff
[ ] Make stars consistent with world location
[ ] Shield generator should have health and UI so can be disrupted
[ ] "Random" spaceship name generator

## Js13kGames

[-] Minifiy under 13312 B.
[x] Remove unused characters?
[x] Remove PWR?
[x] Remove asteroid maxSpeed if it saves space.
[x] Remove OPAL-only asteroid fields.
[ ] Maybe have OPAL-only asteroids in regular fields?
[x] Add 2-4 gems per wreck.
[ ] Make gold asteroid fields stand out somehow.
[ ] Put something at 0,0.
[ ] Try out space station price fluctuations based on distance from asteroids?
[ ] Add wreck notes for station prices if they have them.
[x] Remove the shield generator from the player at the start.
[-] Balance prices (divide by 10 maybe?).
[x] Add 'CARGO 0/12' UI.
[x] Add sound: thruster.
[x] Add sound: Cargo hatch clunk open.
[x] Add sound: Cargo hatch clunk close.
[x] Add sound: Cargo hatch clunk pickup item.
[x] Add sound: metal+stone 'crash' into asteroid for damage taken.
[x] Add sound: shield generator bounce.
[x] Add sound: shield generator activate.
[x] Add sound: shield generator deactivate.
[x] Add sound: UI bleep.
[x] Add sound: torch toggle click.
[x] More asteroids fewer gaps.
[x] Slightly increase number of wrecks and vary loot more.
[x] Change unlocking yellow from destroying a horn drill to reaching the map edge.
[ ] Add slightly more gems per wreck maybe?
[x] Remove controls from bottom right when docked?
[x] Turn modules off while docked again.
[-] Match hit sound to when damage is actually taken? (Was complicated)
[ ] Write 'ESC: LAUNCH' or 'ARROWS TO FLY' or similar at game start.
[x] Add sound: Asteroid crack.
[x] Change sound: Cargo hatch open and close (too similar to hit sound right now).
[x] Make gold asteroid fields have fewer, larger asteroids in, and fewer items.
[ ] Show money spent or gained in top left.
[x] Color unlock explanation messages.
