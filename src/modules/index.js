/**
 * Modules are re-usable parts that can be damaged and destroyed. Stations are
 * built out of them the same way ships are, so a docking bay lives here too.
 *
 * Some modules bring their own geometry (the horn is identical on every ship
 * that has one), others only bring rules and take their shape from the ship
 * they are attached to (every ship has a differently shaped cockpit). None of
 * them bring an angle: a module is drawn the way round it always is, so horns
 * and shields face forwards and thrusters fire backwards wherever they go.
 *
 * Ships and mounting points reference these objects directly rather than by
 * name, because the build mangles property names but leaves string literals
 * alone, so a `fits` list of modules costs less than a list of their names.
 *
 * Every module has a `price` to buy it, and repairing a damaged one costs a
 * tenth of that. A module takes up no cargo `space` unless it says otherwise.
 *
 * Modules bring their own `health` too, except for the ones cut to fit the
 * ship they are in, like the cockpit, which take it from their hull segment.
 * A module that `covers` its ship, as a shield does, is all that ship can be
 * hit on while it is up.
 *
 * A `switched` module is off until its ship turns it on, and every other one
 * is always on. `anim` runs from 0 to 1 over a module's `activationDuration`
 * in seconds while it is on, and back down again once it is off, which is
 * what drives every animation: flares grow out of thrusters, and cargo scoops
 * swing open and closed. A switched module the pilot works by hand names its
 * `key`, the character the controls panel underlines in its name to show it.
 *
 * A module whose pieces switch on separately, like a pair of thrusters, splits
 * itself into `parts` with their own geometry. `zIndex` works like the CSS
 * property: the hull sits at 0, so a module below it is drawn behind the hull
 * and one above it is drawn over the top.
 *
 * A `beam` module is light rather than paint: its shape is added to whatever
 * is already on screen instead of being drawn over it, and it says how far it
 * carries as its `reach`.
 */
import { thrusterDualMd } from './thruster-dual-md';
import { thrusterDualSm } from './thruster-dual-sm';
import { thrusterSingleLg } from './thruster-single-lg';
import { thrusterSingleMd } from './thruster-single-md';
import { thrusterSingleSm } from './thruster-single-sm';
import { thrusterTripleMd } from './thruster-triple-md';
import { thrusterTripleSm } from './thruster-triple-sm';

export { cargoScoop, scoopOpen } from './cargo-scoop';
export { cockpit } from './cockpit';
export { bayCorner, bayDepth, baySpan, dockingBay } from './docking-bay';
export { floodlight } from './floodlight';
export { horn } from './horn';
export { shield } from './shield';
export {
  thrusterDualMd,
  thrusterDualSm,
  thrusterSingleLg,
  thrusterSingleMd,
  thrusterSingleSm,
  thrusterTripleMd,
  thrusterTripleSm,
};

// Weakest first, which is the order a pilot works their way up through them
export const thrusters = [
  thrusterSingleSm,
  thrusterDualSm,
  thrusterSingleMd,
  thrusterDualMd,
  thrusterSingleLg,
  thrusterTripleSm,
  thrusterTripleMd,
];
