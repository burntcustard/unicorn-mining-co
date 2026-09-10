import { damage } from './ship';

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
const easing = 0.4;

// Overlap shallower than this is left well alone
const slop = 0.5;

// The most any one contact may shift a thing, so that a deep overlap eases
// apart over a few frames rather than firing it off
const maxCorrection = 12;

// Below this a knock is dead rather than springy, or everything ends up
// trembling on bounces too small to see
const deadSpeed = 5;

/**
 * Resolve every physical contact using the same mass-weighted impulse and
 * positional correction. Non-physical colliders still report their contacts
 * to gameplay but never arrive here as a special collision category.
 *
 * @param {Object[]} contacts
 */
export const resolve = (contacts) => contacts.forEach(({ collider, depth, other, x, y, point }) => {
  if (collider.physics === false || other.physics === false) return;

  const a = collider.owner || collider;
  const b = other.owner || other;
  const aMass = a.mass ? 1 / a.mass : 0;
  const bMass = b.mass ? 1 / b.mass : 0;
  const mass = aMass + bMass;

  // Unneccessary, only station walls have 0 mass and they won't collide with each other
  // if (!mass) return;

  const aSpin = a.momentum?.(collider) || { x: 0, y: 0 };
  const bSpin = b.momentum?.(other) || { x: 0, y: 0 };
  const closing = (b.velocity.x + bSpin.x - a.velocity.x - aSpin.x) * x +
    (b.velocity.y + bSpin.y - a.velocity.y - aSpin.y) * y -
    ((collider.speed || 0) + (other.speed || 0));

  if (closing < 0) {
    let bounce = 0;
    const force = -closing / mass;

    // A gentle bump is harmless after damage is rounded to whole points.
    let amount;

    if ((amount = Math.round((force - 400) / 1200))) {
      damage(collider, amount, point);
      damage(other, amount, point);
    }

    if (-closing >= deadSpeed) {
      bounce = (collider.bounciness || 0) + (other.bounciness || 0);
    }

    const impulse = force * (1 + bounce);

    a.velocity.x -= x * impulse * aMass;
    a.velocity.y -= y * impulse * aMass;
    b.velocity.x += x * impulse * bMass;
    b.velocity.y += y * impulse * bMass;
  }

  const correction = Math.min((depth - slop) * easing, maxCorrection) / mass;

  if (correction > 0) {
    a.position.x -= x * correction * aMass;
    a.position.y -= y * correction * aMass;
    b.position.x += x * correction * bMass;
    b.position.y += y * correction * bMass;
  }
});
