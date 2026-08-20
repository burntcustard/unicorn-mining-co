import { hit } from './collisions';
import { spray } from './shrapnel';

/**
 * Grinding a rock open with the horn, and nothing about finding the rock in
 * the first place: collisions.js says what the horn is touching, and all this
 * does is lean on it long enough to crack it and let out what was inside.
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
    const rock = hitbox === collider ? other : collider;
    const { segment } = hitbox;

    if (!segment?.module.grinds || segment.anim <= 0.5 || !rock.stroke) return;

    const [tipX, tipY] = tipOf(hitbox);

    // A small round cutting tip reaches slightly into inward corners without
    // letting the wide base of the horn mine whatever it brushes side-on
    if (!hit(rock, { radius: 3, x: tipX, y: tipY })) return;

    rock.grinding = segment.module.damage;
    rock.grindX = tipX;
    rock.grindY = tipY;
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
 * Damage a rock while it is being ground and break it when its health is gone.
 * Called once per fixed game-loop update, however many physics substeps found
 * the horn touching it.
 *
 * @param {Object} rock
 * @param {Number} dt - Seconds since the last update.
 * @param {Object[]} scenery - The rock is taken out of this when it breaks.
 * @param {Object[]} items - Its freed cargo is added to this.
 */
export const grind = (rock, dt, scenery, items) => {
  if (!rock.grinding) return;

  // Sparks stream off wherever the horn is biting for as long as it grinds,
  // in the colour of the rock's own outline
  spray(rock.grindX, rock.grindY, rock.stroke, grindRate * dt, rock);

  rock.health -= rock.grinding;
  // Set fresh each update it is touched, so damage is applied only once
  rock.grinding = 0;

  if (rock.health < 1) breakRock(rock, scenery, items);
};
