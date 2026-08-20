import { hit } from './collisions';
import { remove } from './item';
import { spray } from './shrapnel';

/**
 * Damage from a mining horn, and nothing about finding what it is touching:
 * collisions.js supplies those contacts.
 */

// How hard the freed cargo is flung apart as the rock lets go of it
const scatter = 25;

// How many sparks a second the horn throws off while it grinds, and how many
// go up all at once when a rock finally gives way
const grindRate = 50;
const breakBurst = 24;

/**
 * Where the point of a horn is in the world: the vertex of its shape reaching
 * furthest ahead of the mount, turned into place with the ship.
 *
 * @param {Object} hitbox - A horn's piece of a craft.
 * @returns {Number[]} [x, y]
 */
const tipOf = (hitbox) => {
  const [tipX, tipY] = hitbox.outline.reduce((far, corner) => (corner[0] > far[0] ? corner : far));
  const cos = Math.cos(hitbox.rotation);
  const sin = Math.sin(hitbox.rotation);

  return [
    hitbox.x + tipX * cos - tipY * sin,
    hitbox.y + tipX * sin + tipY * cos,
  ];
};

/**
 * Flag the rocks an active mining horn is biting into, so they can be counted
 * down towards breaking open. A horn is a wide thing that touches a rock all
 * along its side at an angle, but it only grinds at its point, so this asks
 * where the tip actually is rather than trusting a touch anywhere on the shape.
 *
 * @param {Object[]} contacts - Contacts from the shared world collision pass.
 */
export const mine = (contacts) => {
  contacts.forEach(({ collider, other }) => {
    const hitbox = collider.segment?.module.grinds ? collider : other;
    const object = hitbox === collider ? other : collider;
    const { segment } = hitbox;
    const target = object.segment?.healthFrom || object.segment || object;

    if (!segment?.module.grinds || segment.anim <= 0.5 || !target.health) return;

    const [tipX, tipY] = tipOf(hitbox);

    // A small round cutting tip reaches slightly into inward corners without
    // letting the wide base of the horn mine whatever it brushes side-on
    if (!hit(object, { radius: 3, x: tipX, y: tipY })) return;

    target.grinding = segment.module.damage;
    target.grindX = tipX;
    target.grindY = tipY;
    target.grindColor = object.stroke || object.segment?.stroke;
    target.grindCarry = object.owner || object;
  });
};

/**
 * Split a rock open: take it out of the world and cut everything it was
 * holding loose, flung apart and armed so an unstable find starts ticking.
 *
 * @param {Object} rock
 * @param {Object[]} scenery - The rock is taken out of this.
 * @param {Object[]} items - Its freed cargo is added to this.
 */
const breakRock = (rock, scenery, items) => {
  // A last shower of shrapnel in the rock's own colour as it gives way
  spray(rock.x, rock.y, rock.stroke, breakBurst, rock);

  scenery.splice(scenery.indexOf(rock), 1);

  // An empty rock just breaks apart; one with cargo lets it loose
  rock.contents?.forEach((item) => {
    // Carries the rock's own drift, plus a shove of its own so the haul spreads
    // out rather than sitting in a clump where the rock was
    item.dx = rock.dx + (Math.random() * 2 - 1) * scatter;
    item.dy = rock.dy + (Math.random() * 2 - 1) * scatter;
    item.spin = Math.random() - 0.5;
    item.arm();

    items.push(item);
  });
};

/**
 * Apply one update's mining damage and destroy anything whose health is gone.
 * Called once per fixed game-loop update, however many physics substeps found
 * the horn touching it.
 *
 * @param {Object} target
 * @param {Number} dt - Seconds since the last update.
 * @param {Object[]} scenery - The rock is taken out of this when it breaks.
 * @param {Object[]} items - Its freed cargo is added to this.
 */
export const grind = (target, dt, scenery, items) => {
  if (!target.grinding) return;

  // Sparks stream off wherever the horn is biting for as long as it grinds,
  // in the colour of the rock's own outline
  spray(target.grindX, target.grindY, target.grindColor, grindRate * dt, target.grindCarry);

  target.health -= target.grinding;
  // Set fresh each update it is touched, so damage is applied only once
  target.grinding = 0;

  if (target.health < 1) {
    if (scenery.includes(target)) breakRock(target, scenery, items);
    else if (items.includes(target)) remove(target, items);
  }
};
