import { earn, roomFor, say, stow } from './player';
import { collisions } from './collisions';
import { remove } from './item';
import { scoopOpen } from './modules';
import { settle } from './resolve';

/**
 * Everything a ship does to the loose cargo it runs into.
 *
 * A hull shoves cargo aside rather than being stopped by it, since a gem the
 * size of a fist has no business halting a ship. The exception is the piece
 * of hull a scoop opens onto, which stops pushing while the doors are open so
 * that there is a way in at all. The doors themselves are solid, so a rock
 * that meets one slides along it towards the middle, and the throat behind
 * them takes in whatever gets that far.
 *
 * That is the whole of the funnel: two walls and a hole in the hull between
 * them. Nothing reaches out and grabs anything.
 */

/**
 * @param {Object} ship
 * @param {Object[]} items - Everything loose, which the caught are taken out of.
 */
export const scoop = (ship, items) => {
  const open = ship.segments.some(({ anim, health, module }) => (
    module.scoops && health && anim > scoopOpen
  ));

  ship.hitboxes().forEach((hitbox) => {
    const { segment } = hitbox;

    collisions(hitbox).forEach(({ depth, other, x, y }) => {
      if (!other.item) return;

      if (segment.catches) {
        // Taken in once its middle reaches the throat, rather than the moment
        // a corner of it brushes the edge, or cargo winks out while it still
        // looks to be outside the ship
        if (Math.hypot(other.x - hitbox.x, other.y - hitbox.y) > hitbox.radius) return;

        // Money is money, so it goes straight into the pilot's account and
        // there is never no room for it
        if (other.item.credits) {
          earn(other.item.credits);
          say(`$${other.item.credits} RECOVERED`);
        } else if (other.message) {
          // Read on the way in and thrown away after, so a note never costs a
          // hold anything to carry
          say(other.message);
        } else {
          if (!roomFor(ship)) return;

          stow(other);
          say(other.name.toUpperCase());
        }

        remove(other, items);

        return;
      }

      // The way in, while there is one
      if (open && segment.mouth) return;

      // Shoved clear of the ship rather than the ship off it, and settled the
      // same way everything else is
      settle(other, ship, depth, x, y,
        Math.max(hitbox.bounciness || 0, other.bounciness || 0));
    });
  });
};
