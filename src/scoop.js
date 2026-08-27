import { earn, roomFor, say, stow } from './player';
import { remove } from './item';

/**
 * Taking cargo aboard, and nothing else. Shoving it about on the way in is
 * ordinary physics and lives with the rest of the physics: all a scoop does is
 * notice what has reached its throat and decide what becomes of it.
 */

/**
 * @param {Object[]} items - Everything loose, which the caught are taken out of.
 * @param {Object[]} contacts - What each craft is touching, gathered once.
 */
export const scoop = (items, contacts) => {
  contacts.forEach(({ collider, other }) => {
    const hitbox = collider.segment?.catches ? collider : other;
    const item = hitbox === collider ? other : collider;

    if (!item.item || !hitbox.segment?.catches || !items.includes(item)) return;

    const craft = hitbox.owner;

    // Taken in once its middle reaches the throat, rather than the moment a
    // corner of it brushes the edge, or cargo winks out while it still looks
    // to be outside the ship
    if (item.position.distance(hitbox) > hitbox.radius) return;

    // Money is money, so it goes straight into the pilot's account and there
    // is never no room for it
    if (item.item.credits) {
      earn(item.item.credits);
      say(`$${item.item.credits} RECOVERED`);
    } else if (item.message) {
      // Read on the way in and thrown away after, so a note never costs a
      // hold anything to carry
      say(item.message);
    } else {
      if (!roomFor(craft)) return;

      stow(craft, item);
      say(item.name);
    }

    remove(item, items);
  });
};
