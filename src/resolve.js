import { Vector } from './vector';
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

/**
 * How springy two things are together. Normally the springier of the two has
 * its way, so a shield bouncing off an asteroid bounces like a shield. A negative
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

  const normal = Vector(x, y);
  const aSpin = a.momentum?.(collider) || Vector();
  const bSpin = b.momentum?.(other) || Vector();
  const closing = b.velocity
    .add(bSpin)
    .subtract(a.velocity)
    .subtract(aSpin)
    .dot(normal) - ((collider.speed || 0) + (other.speed || 0));

  if (closing < 0) {
    let bounce = 0;
    const force = -closing / mass;

    if (force > 500) {
      [[collider, a], [other, b]].forEach(([hitbox, body]) =>
        body.cockpit && damage(hitbox.segment, (force - 500) / 2000));
    }

    if (-closing >= deadSpeed) {
      bounce = combineBounce(collider.bounciness || 0, other.bounciness || 0);
    }

    const impulse = force * (1 + bounce);

    const push = normal.scale(impulse);

    a.velocity.set(a.velocity.subtract(push.scale(aMass)));
    b.velocity.set(b.velocity.add(push.scale(bMass)));
  }

  const correction = Math.min((depth - slop) * easing, maxCorrection) / mass;

  if (correction > 0) {
    const push = normal.scale(correction);

    a.position.set(a.position.subtract(push.scale(aMass)));
    b.position.set(b.position.add(push.scale(bMass)));
  }
});
