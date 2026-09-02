/**
 * Items are the loose things of the world: not ships, not stations, and not
 * bolted to either. They are cut out of asteroids, drift about on their own,
 * get scooped up, and are sold on again at a station.
 *
 * Like modules, they are plain data referenced directly rather than by name,
 * because the build mangles property names but leaves string literals alone.
 * Everything drawn from one is built once by `Item`, so a definition is only
 * ever the numbers that make this item different from the last.
 *
 * Every item has a `name`, a `price` it changes hands for, `health` before it
 * is destroyed, and how much of a `bounciness` it gives back. Every item is the
 * same weight and drags alike, so `Item` sets those rather than each one here.
 * Anything stowed fills exactly one of a cargo bay, so none of them say how much
 * room they take.
 *
 * An item brings either `points` or a `radius`, and that one shape is both
 * what it is drawn as and what it is hit on. A cut item gives `points`, which
 * are collided with exactly. A round one gives a `radius` instead and is
 * collided with as a circle, which is cheaper as well as truer than any number
 * of corners would be. `lines` are drawn over the top of whichever it is, and
 * are never collided with.
 *
 * `shades` supplies the fixed fill and outline colours. `fillAlpha` can append
 * a hexadecimal alpha digit to make that fill partly transparent. A `glint`
 * item wears a sparkle, and a `rainbow` item fills itself with several colours
 * without following the light.
 *
 * The rest are what an item does when it is picked up or left alone: `credits`
 * are paid straight into the pilot's account rather than stowed instead of
 * being sold on, `message` is read out and used up on the spot, and a `fuse`
 * is how many seconds an item has left once it is cut loose, after which it
 * goes off.
 */
export { amethyst } from './amethyst';
export { diamond } from './diamond';
export { explosive } from './explosive';
export { gold } from './gold';
export { message } from './message';
export { opal } from './opal';
// export { platinum } from './platinum';

import { amethyst } from './amethyst';
import { diamond } from './diamond';
import { explosive } from './explosive';
import { gold } from './gold';
import { message } from './message';
import { opal } from './opal';
// import { platinum } from './platinum';

// Dearest first, which is the order an asteroid is worth breaking open for
export const itemTypes = [
  diamond,
  // platinum, // Platinum disabled to save a few bytes
  amethyst,
  gold,
  opal,
  explosive,
  message,
];
