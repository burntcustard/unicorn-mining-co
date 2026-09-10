import { roomFor, say, stow, unlockColor } from './player';
import { game } from './game';

/**
 * Taking cargo aboard, and nothing else. Shoving it about on the way in is
 * ordinary physics and lives with the rest of the physics: all a scoop does is
 * notice what has reached its throat and decide what becomes of it.
 */

/**
 * @param {Object[]} contacts - What each craft is touching, gathered once.
 */
export const scoop = (contacts) => {
  contacts.forEach(({ collider, other }) => {
    const hitbox = collider.segment?.catches ? collider : other;
    const item = hitbox === collider ? other : collider;

    // Collection removes the item from sprites, so stale contacts cannot take it twice.
    if (!item.item || !hitbox.segment?.catches || !game.sprites.includes(item)) return;

    const craft = hitbox.owner;

    // Taken in once its middle reaches the throat, rather than the moment a
    // corner of it brushes the edge, or cargo winks out while it still looks
    // to be outside the ship
    if (item.position.distanceTo(hitbox) > hitbox.radius) return;

    if (item.message) {
      // Read on the way in and thrown away after, so a note never costs a
      // hold anything to carry
      if (!item.unlock || !unlockColor(item.unlock)) say(item.message);
    } else {
      if (!roomFor(craft)) return;

      stow(craft, item);
      say(item.name);
    }

    item.remove();
  });
};
