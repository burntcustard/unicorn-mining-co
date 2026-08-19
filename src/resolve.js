import { collisions } from './collisions';
import { scoopOpen } from './modules';

/**
 * What a collision does, once collisions.js has found one. Kept well apart
 * from the finding of them, the way Box2D and Matter.js keep them apart, and
 * in the same two steps for the same reasons.
 *
 * Speed first. The part of the closing speed running straight into a surface
 * is turned back on itself, and the part running along it is left alone, so a
 * glancing blow slides rather than stopping dead.
 *
 * Place second, and never all of it at once. Box2D takes out a fifth of an
 * overlap a frame on the grounds that taking out the lot overshoots, caps how
 * far any one contact may shift a thing, and leaves a sliver of overlap alone
 * entirely so that things at rest settle instead of buzzing against whatever
 * they are resting on. All three of those are why this eases rather than
 * teleports: shoving a thing the whole way clear in one frame is what throws
 * it across the screen when the thing it is inside of is large.
 */

// How much of what is left of an overlap comes out in one go, which Box2D
// calls baumgarte and sets to a fifth
const easing = 0.2;

// Overlap shallower than this is left well alone
const slop = 0.5;

// The most any one contact may shift a thing, so that a deep overlap eases
// apart over a few frames rather than firing it off
const maxCorrection = 4;

// Below this a knock is dead rather than springy, or everything ends up
// trembling on bounces too small to see
const deadSpeed = 5;

/**
 * How springy two things are together. Normally the springier of the two has
 * its way, so a shield bouncing off a rock bounces like a shield. A negative
 * bounciness, like a spinning horn's, grips rather than bounces, and the firmest
 * grip wins: it holds a ship against whatever it has hold of instead of letting
 * it spring off, while staying above minus one so it only ever softens the
 * knock rather than feeding speed back in and flinging the ship about.
 *
 * @param {Number} a
 * @param {Number} b
 * @returns {Number} bounciness
 */
const combineBounce = (a, b) => (a < 0 || b < 0 ? Math.min(a, b) : Math.max(a, b));

/**
 * Put one object out of another, and take the speed it arrived with out of it.
 * Whatever it ran into stays where it is: a rock is not shifted by a ship.
 *
 * @param {Object} object - The one being moved.
 * @param {Object} other - What it ran into.
 * @param {Number} depth - How far into each other the two are.
 * @param {Number} awayX - The way out, pointing from the other to the object.
 * @param {Number} awayY
 * @param {Number} bounciness
 */
export const settle = (object, other, depth, awayX, awayY, bounciness) => {
  // Taken against whatever it hit rather than against the world, so an object
  // already travelling along with something is not flicked off it
  const closing = (object.dx - (other.dx || 0)) * awayX + (object.dy - (other.dy || 0)) * awayY;

  // Only speed that is closing the gap is worth turning round
  if (closing < 0) {
    const springy = -closing < deadSpeed ? 0 : bounciness;

    object.dx -= awayX * closing * (1 + springy);
    object.dy -= awayY * closing * (1 + springy);
  }

  const ease = Math.min((depth - slop) * easing, maxCorrection);

  if (ease > 0) {
    object.x += awayX * ease;
    object.y += awayY * ease;
  }
};

/**
 * Everything a ship is touching, gathered in one go. Working the same nine
 * cells out again for every separate thing that cares about the answer is the
 * most expensive mistake there is to make here, so it is done once and read
 * by all of them.
 *
 * @param {Object} ship
 * @returns {Object[]} contacts - Each carrying the piece of ship that touched.
 */
export const contactsOf = (ship) => ship.hitboxes().flatMap((hitbox) => (
  collisions(hitbox).map((contact) => (contact.hitbox = hitbox, contact))
));

/**
 * Settle a ship against everything it is touching. Which of the two moves is
 * the only difference between one contact and the next: a hull shoves loose
 * cargo aside, since a gem the size of a fist has no business halting a ship,
 * and is itself shoved by everything solid.
 *
 * @param {Object} ship
 * @param {Object[]} contacts
 */
export const resolve = (ship, contacts) => {
  const open = ship.segments.some(({ anim, health, module }) => (
    module.scoops && health && anim > scoopOpen
  ));

  contacts.forEach(({ depth, hitbox, other, x, y }) => {
    const { segment } = hitbox;

    // A throat is there to notice what has got inside it, not to shove things
    if (segment.catches) return;

    // Open things are flown straight through, so they never push back
    if (other.open) return;

    const bounciness = combineBounce(hitbox.bounciness || 0, other.bounciness || 0);

    // The way out runs from the hull towards what it hit, so a ship coming off
    // something solid has to go the other way
    if (!other.item) {
      settle(ship, other, depth, -x, -y, bounciness);

      return;
    }

    // The piece of hull a scoop opens onto stands aside while the doors are
    // open, or there is no way in for anything it gathers
    if (open && segment.mouth) return;

    settle(other, ship, depth, x, y, bounciness);
  });
};
