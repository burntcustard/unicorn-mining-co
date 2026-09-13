import { playSound, soundEffects } from './sound';
import { Asteroid } from './asteroid';
import { damage } from './ship';

/**
 * Damage from a mining horn, and nothing about finding what it is touching:
 * collisions.js supplies those contacts.
 */

// Segments flagged as biting last call, so the flag can be cleared for
// anything that stopped touching a target before this call sets it again
let biting = [];

/**
 * Flag the asteroids an active mining horn is biting into, so they can be counted
 * down towards breaking open. Its dedicated non-physical tip collider is the
 * only horn contact that is allowed to grind.
 *
 * @param {Object[]} contacts - Contacts from the normal-rate physics pass.
 */
export const mine = (contacts) => {
  const surfaces = [];

  biting.forEach((segment) => segment.biting = false);
  biting = [];

  contacts.forEach(({ collider, other, depth }) => {
    const hitbox = collider.segment?.module?.grinds ? collider : other;
    const object = hitbox === collider ? other : collider;
    const { segment } = hitbox;
    const target = object.segment || object;

    if (!segment?.module?.grinds || hitbox.physics || segment.activationProgress <= 0.5 || !target.health) return;

    surfaces.push({ depth, hitbox, object, segment, target });
  });

  const targets = [];

  // A deeper tip overlap means the surface is nearer the tip's centre. Each
  // drill bites only the first of its touching surfaces.
  surfaces.sort((a, b) => b.depth - a.depth).forEach((surface) => {
    const { hitbox, segment, target } = surface;

    if (biting.includes(segment)) return;

    segment.biting = true;
    biting.push(segment);
    target.grinding = surface;
    surface.point = [hitbox.x, hitbox.y];
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
  const grinder = target.grinding?.hitbox?.owner;

  if (grinder) grinder.velocity.set(asteroid.velocity);

  if (destroyed && !target.asteroid && !target.sections) {
    playSound(soundEffects.asteroidBreak);
  }

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

  const { object, segment, hitbox, point } = target.grinding;
  const grinder = hitbox.owner;
  const carry = object.owner || object;
  const pull = carry.position.subtract(grinder.position).normalize();
  const grip = carry.velocity.subtract(grinder.velocity).scale(0.1).add(pull);

  grinder.velocity.set(grinder.velocity.add(grip));

  damage(object, segment.module.damage, point);
  // Set fresh each update it is touched, so damage is applied only once
  target.grinding = 0;
};

export const fracture = (target) => {
  const { health } = target;

  if (target.asteroid && health < 1) {
    // A pre-cut leaf comes free well shy of zero instead of first turning
    // into another set of pieces.
    breakAsteroid(target);
  } else if (health < 1) {
    if (target.asteroid || target instanceof Asteroid) {
      breakAsteroid(target, true);
    } else if (target.item) {
      target.remove();
    }
  }
};
