import { collisions } from './collisions';

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
 * Put one thing out of another, and take the speed it arrived with out of it.
 * Whatever it ran into stays where it is: a rock is not shifted by a ship.
 *
 * @param {Object} thing - The one being moved.
 * @param {Object} other - What it ran into.
 * @param {Number} depth - How far into each other the two are.
 * @param {Number} awayX - The way out, pointing from the other to the thing.
 * @param {Number} awayY
 * @param {Number} bounciness
 */
export const settle = (thing, other, depth, awayX, awayY, bounciness) => {
  // Taken against whatever it hit rather than against the world, so a thing
  // already travelling along with something is not flicked off it
  const closing = (thing.dx - (other.dx || 0)) * awayX + (thing.dy - (other.dy || 0)) * awayY;

  // Only speed that is closing the gap is worth turning round
  if (closing < 0) {
    const springy = -closing < deadSpeed ? 0 : bounciness;

    thing.dx -= awayX * closing * (1 + springy);
    thing.dy -= awayY * closing * (1 + springy);
  }

  const ease = Math.min((depth - slop) * easing, maxCorrection);

  if (ease > 0) {
    thing.x += awayX * ease;
    thing.y += awayY * ease;
  }
};

/**
 * Come off whatever a ship has run into. Each piece of hull is checked on its
 * own, so it is the part that actually touched that stops the ship, and
 * whichever of the two is springier says how much of a bounce there is.
 *
 * @param {Object} ship
 */
export const bounceOff = (ship) => {
  ship.hitboxes().forEach((hitbox) => {
    // A throat is there to notice what has got inside it, not to shove things
    if (hitbox.segment.catches) return;

    collisions(hitbox).forEach(({ depth, other, x, y }) => {
      // Open things are flown straight through, so they never push back
      if (other.open) return;

      // Loose cargo is shoved aside by a ship rather than stopping one, which
      // is the scoop's business rather than this file's
      if (other.item) return;

      // The way out runs from the hull towards what it hit, so the ship itself
      // has to go the other way
      settle(ship, other, depth, -x, -y,
        Math.max(hitbox.bounciness || 0, other.bounciness || 0));
    });
  });
};
