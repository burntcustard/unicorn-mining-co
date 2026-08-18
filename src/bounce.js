import { collisions } from './collisions';

/**
 * Shove a ship back out of whatever it has run into and turn the speed it
 * arrived with back on itself, so that it comes off a rock rather than
 * grinding its way through one. Each piece of hull is checked on its own, so
 * it is the part that actually touched that stops the ship.
 *
 * Whichever of the two is the springier says how much of a bounce there is,
 * so a shield throws a rock off however soft the hull behind it may be.
 *
 * @param {Object} ship
 */
export const bounceOff = (ship) => {
  ship.hitboxes().forEach((hitbox) => {
    collisions(hitbox).forEach(({ depth, other, x, y }) => {
      // Open things are flown straight through, so they never push back
      if (other.open) return;

      const bounciness = Math.max(hitbox.bounciness || 0, other.bounciness || 0);
      const into = ship.dx * x + ship.dy * y;

      ship.x -= x * depth;
      ship.y -= y * depth;

      // Speed along the surface is left alone, so a glancing blow slides
      if (into > 0) {
        ship.dx -= x * into * (1 + bounciness);
        ship.dy -= y * into * (1 + bounciness);
      }
    });
  });
};
