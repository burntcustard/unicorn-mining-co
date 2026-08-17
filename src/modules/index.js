/**
 * Modules are re-usable ship parts that can be damaged and destroyed.
 *
 * Some modules bring their own geometry (the horn is identical on every ship
 * that has one), others only bring rules and take their shape from the ship
 * they are attached to (every ship has a differently shaped cockpit).
 *
 * Ships reference these objects directly rather than by name, because the
 * build mangles property names but leaves string literals alone.
 */
export { cockpit } from './cockpit';
export { horn } from './horn';
export { thruster } from './thruster';
