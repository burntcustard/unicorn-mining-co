import { Asteroid } from './asteroid';
import { damage } from './ship';

/**
 * Damage from a mining horn, and nothing about finding what it is touching:
 * collisions.js supplies those contacts.
 */

// How much of a leaf's own health is left when it comes free of the rest
const crackHealth = 0.25;

/**
 * Flag the asteroids an active mining horn is biting into, so they can be counted
 * down towards breaking open. Its dedicated non-physical tip collider is the
 * only horn contact that is allowed to grind.
 *
 * @param {Object[]} contacts - Contacts from the normal-rate physics pass.
 */
export const mine = (contacts) => {
  const surfaces = [];

  contacts.forEach(({ collider, other, depth }) => {
    const hitbox = collider.segment?.module?.grinds ? collider : other;
    const object = hitbox === collider ? other : collider;
    const { segment } = hitbox;
    const target = object.segment || object;

    if (!segment?.module?.grinds || hitbox.physics || segment.activationProgress <= 0.5 || !target.health) return;

    surfaces.push({ depth, hitbox, object, segment, target });
  });

  const drills = [];
  const targets = [];

  // A deeper tip overlap means the surface is nearer the tip's centre. Each
  // drill bites only the first of its touching surfaces.
  surfaces.sort((a, b) => b.depth - a.depth).forEach((surface) => {
    const { hitbox, object, segment, target } = surface;

    if (drills.includes(segment)) return;
    drills.push(segment);

    target.grinding = segment.module.damage;
    target.grindPoint = [hitbox.x, hitbox.y];
    target.grindObject = object;
    target.grindCarry = object.owner || object;
    target.grinder = hitbox.owner;
    if (!targets.includes(target)) targets.push(target);
  });

  return targets;
};

/**
 * Split an asteroid along the mined leaf. Cargo stays with its assigned leaf
 * until that leaf dies, then falls into space.
 *
 * @param {Object} asteroid
 */
const breakAsteroid = (target, destroyed) => {
  const asteroid = target.asteroid || target;

  if (asteroid.dead) return;

  // Let go at the asteroid's speed rather than releasing all the approach
  // speed that the active horn's grip had been holding back
  if (target.grinder) target.grinder.velocity.set(asteroid.velocity);

  const [, loose] = target.asteroid ? asteroid.detach(target, destroyed) : asteroid.split();

  asteroid.remove();

  loose.forEach((item) => {
    item.velocity.set(asteroid.velocity);
    item.buried = 0;
  });
};

/**
 * Apply one update's mining damage and destroy anything whose health is gone.
 * Called once per fixed game-loop update, however many physics substeps found
 * the horn touching it.
 *
 * @param {Object} target
 */
export const grind = (target) => {
  if (!target.grinding) return;

  const pull = target.grindCarry.position.subtract(target.grinder.position).normalize();
  const grip = target.grindCarry.velocity.subtract(target.grinder.velocity).scale(0.1).add(pull);

  target.grinder.velocity.set(target.grinder.velocity.add(grip));

  damage(target.grindObject, target.grinding, target.grindPoint);
  // Set fresh each update it is touched, so damage is applied only once
  target.grinder = target.grinding = 0;
};

export const fracture = (target) => {
  const { health } = target;

  if (health < 1) {
    if (target.asteroid || target instanceof Asteroid) {
      breakAsteroid(target, true);
    } else if (target.item) {
      target.remove();
    }
  } else if (target.asteroid && health <= target.maxHealth * crackHealth) {
    // A pre-cut leaf comes free well shy of zero instead of first turning
    // into another set of pieces.
    breakAsteroid(target);
  }
};
