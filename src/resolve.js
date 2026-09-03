import { damage } from './craft';

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

// Anything lighter than this bounces off a ship without marking it, so loose
// items shove about underfoot rather than wearing a hull down
const dentingMass = 10;

/**
 * How springy two things are together. Normally the springier of the two has
 * its way, so a shield bouncing off an asteroid bounces like a shield. A negative
 * bounciness, like a spinning horn's, overrides the other surface and requests
 * zero restitution: normal speeds match at the contact, so the drill neither
 * rebounds nor retains velocity carrying it through the surface.
 *
 * @param {Number} a
 * @param {Number} b
 * @returns {Number} bounciness
 */
const combineBounce = (a, b) => (a < 0 || b < 0 ? 0 : Math.max(a, b));

/**
 * Resolve every physical contact using the same mass-weighted impulse and
 * positional correction. Non-physical colliders still report their contacts
 * to gameplay but never arrive here as a special collision category.
 *
 * @param {Object[]} contacts
 */
export const resolve = (contacts) => contacts.forEach(({ collider, depth, other, x, y }) => {
  if (collider.physics === false || other.physics === false) return;

  const a = collider.owner || collider;
  const b = other.owner || other;
  const aMass = a.mass ? 1 / a.mass : 0;
  const bMass = b.mass ? 1 / b.mass : 0;
  const mass = aMass + bMass;

  if (!mass) return;

  const aSpin = a.momentum?.(collider);
  const bSpin = b.momentum?.(other);
  const closing = (b.velocity.x + (bSpin?.x || 0) - a.velocity.x - (aSpin?.x || 0)) * x +
    (b.velocity.y + (bSpin?.y || 0) - a.velocity.y - (aSpin?.y || 0)) * y -
    ((collider.speed || 0) + (other.speed || 0));

  if (closing < 0) {
    let bounce = 0;
    const force = -closing / mass;

    if (force > 500) {
      const amount = (force - 500) / 2000;

      if (a.cockpit && b.mass >= dentingMass) damage(collider.segment, amount);
      if (b.cockpit && a.mass >= dentingMass) damage(other.segment, amount);
    }

    if (-closing >= deadSpeed) {
      bounce = combineBounce(collider.bounciness || 0, other.bounciness || 0);
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
