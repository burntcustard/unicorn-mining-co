import { earn, roomFor, say, stow } from './player';
import { remove } from './item';

/**
 * Taking cargo aboard, and nothing else. Shoving it about on the way in is
 * ordinary physics and lives with the rest of the physics: all a scoop does is
 * notice what has reached its throat and decide what becomes of it.
 */

/**
 * @param {Object} ship
 * @param {Object[]} items - Everything loose, which the caught are taken out of.
 * @param {Object[]} contacts - What the ship is touching, gathered once.
 */
export const scoop = (ship, items, contacts) => {
  contacts.forEach(({ hitbox, other }) => {
    if (!other.item || !hitbox.segment.catches) return;

    // Taken in once its middle reaches the throat, rather than the moment a
    // corner of it brushes the edge, or cargo winks out while it still looks
    // to be outside the ship
    if (Math.hypot(other.x - hitbox.x, other.y - hitbox.y) > hitbox.radius) return;

    // Money is money, so it goes straight into the pilot's account and there
    // is never no room for it
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
  });
};
