/**
 * Modules are re-usable parts that can be damaged and destroyed, fitted to the
 * mounting points of a ship's hull.
 *
 * Modules bring their own geometry and no angle: a module is drawn the way
 * round it always is, so horns and shields face forwards and thrusters fire
 * backwards wherever they go.
 *
 * Ships and mounting points reference these objects directly rather than by
 * name, because the build mangles property names but leaves string literals
 * alone, so a `fits` list of modules costs less than a list of their names.
 *
 * Every module has a `price` to buy it and `powerUsage` while active. A module
 * that is owned but not fitted waits in its ship's `cargoBay`, taking one space
 * there like any other piece of cargo.
 *
 * A non-physical module with `health` is damaged with its hull. A solid `model`
 * with `health` is damaged directly; a healthless module vanishes with its hull.
 * A module takes no damage at all while its `active` matches its `unhurtWhen`.
 * A module that `covers` its ship, as a shield does, is all that ship can be
 * hit on while it is up.
 *
 * Every module starts off. `activationProgress` runs from 0 to 1 over a module's
 * `activationDuration` in seconds while it is active, and back down again once it is off, which is
 * what drives every animation: flares grow out of thrusters, and cargo scoops
 * swing open and closed. A module the pilot works by hand names its
 * `key`, the character the controls panel underlines in its name to show it.
 *
 * A module whose pieces switch on separately, like a pair of thrusters, splits
 * its geometry into `model`; visual-only modules set `disablePhysics`. They
 * still report contacts to gameplay, but never apply physics.
 * `zIndex` works like the CSS
 * property: the hull sits at 0, so a module below it is drawn behind the hull
 * and one above it is drawn over the top.
 *
 * A `beam` module is light rather than paint: its shape is added to whatever
 * is already on screen instead of being drawn over it, and it says how far it
 * carries as its `reach`.
 */
import { thrusterDualMd } from './thruster-dual-md';
import { thrusterDualXl } from './thruster-dual-xl';
import { thrusterSingleMd } from './thruster-single-md';
import { thrusterSingleXl } from './thruster-single-xl';
import { thrusterTriple } from './thruster-triple';

export { cargoScoop, scoopOpen } from './cargo-scoop';
export { floodlight } from './floodlight';
export { horn } from './horn';
export { shield } from './shield';
export {
  thrusterDualMd,
  thrusterDualXl,
  thrusterSingleMd,
  thrusterSingleXl,
  thrusterTriple,
};

// Weakest first, which is the order a pilot works their way up through them
export const thrusters = [
  thrusterSingleXl,
  thrusterDualMd,
  thrusterSingleMd,
  thrusterDualXl,
  thrusterTriple,
];

/**
 * One module the pilot owns, as against the type it is one of. Everything but
 * its own paint is inherited, so a pink scoop and an orange one are two things
 * that can be fitted, sold and painted apart from each other.
 *
 * `oneOf` rather than `type`, which the minifier leaves alone as a DOM name.
 *
 * @param {Object} type - The module in `src/modules` this is one of.
 */
export const instanceOf = (type) => Object.assign(Object.create(type), { oneOf: type });
