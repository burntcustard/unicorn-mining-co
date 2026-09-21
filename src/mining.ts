import { damage } from './ship';
import { type Collider, type Contact, type Point, type Segment } from './types';

type MiningTarget = {
  [key: string]: any;
  asteroid?: MiningTarget;
  grinding?: MiningSurface | 0;
  health: number;
  sections?: unknown[];
};

type MiningSurface = {
  depth: number;
  hitbox: Collider;
  object: Collider;
  point?: Point;
  segment: Segment;
  target: MiningTarget;
};

/**
 * Damage from a mining horn, and nothing about finding what it is touching:
 * collisions.ts supplies those contacts.
 */

// Segments flagged as biting last call, so the flag can be cleared for
// anything that stopped touching a target before this call sets it again
let biting: Segment[] = [];

/**
 * Flag the asteroids an active mining horn is biting into, so they can be counted
 * down towards breaking open. Its dedicated non-physical tip collider is the
 * only horn contact that is allowed to grind.
 *
 * @param {Object[]} contacts - Contacts from the normal-rate physics pass.
 */
export const mine = (contacts: Contact[]) => {
  const surfaces: MiningSurface[] = [];

  biting.forEach((segment) => (segment.biting = false));
  biting = [];

  contacts.forEach(({ collider, other, depth }) => {
    const hitbox = collider.segment?.module?.grinds ? collider : other;
    const object = hitbox === collider ? other : collider;
    const { segment } = hitbox;
    const target = (object.segment || object) as MiningTarget;

    if (
      !segment?.module?.grinds ||
      hitbox.physics ||
      segment.activationProgress <= 0.5 ||
      !target.health
    )
      return;

    surfaces.push({ depth, hitbox, object, segment, target });
  });

  const targets: MiningTarget[] = [];

  // A deeper tip overlap means the surface is nearer the tip's centre. Each
  // drill bites only the first of its touching surfaces.
  surfaces
    .sort((a, b) => b.depth - a.depth)
    .forEach((surface) => {
      const { hitbox, segment, target } = surface;

      if (biting.includes(segment)) return;

      segment.biting = true;
      biting.push(segment);
      target.grinding = surface;
      surface.point = [hitbox.position.x, hitbox.position.y];
      if (!targets.includes(target)) targets.push(target);
    });

  return targets;
};

/**
 * Apply one update's mining damage and destroy anything whose health is gone.
 * Called once per fixed game-loop update, however many physics substeps found
 * the horn touching it.
 *
 * @param {Object} target
 */
export const grind = (target: MiningTarget) => {
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

export const fracture = (target: MiningTarget) => {
  if (target.health < 1 && target.item) target.remove();
};
