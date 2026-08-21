import { colors } from './colors';
import { rotatePoint } from 'kontra';

/**
 * What is left of an unstable rock once its fuse runs out: a flash, and a shove
 * outwards that everything nearby feels.
 *
 * The push is dealt out once, the moment it goes off, rather than pressed on
 * over the life of the flash. A blast is an instant thing that hands out speed
 * and then has nothing more to say, so what is left on screen afterwards is
 * only the look of it.
 */

// How far the shove carries, in game units
const reach = 130;

// How hard it pushes at the very middle, in game units a second per unit of
// mass, and how much hull it takes off whatever is sat right on top of it
const force = 2200;
const damage = 35;

// Seconds the flash lasts, and how far past the shove its ring runs, since
// light carries further than anything it is thrown by
const life = 0.5;
const flashReach = reach * 1.15;

export const blasts = [];

// Nothing at the edge, everything at the middle, and a curve between the two
// so that standing a little way off is worth much more than standing just
// outside the far edge
const shareAt = (distance) => Math.max(0, 1 - distance / reach) ** 2;

/**
 * Set one off, and shove everything near it clear.
 *
 * @param {Object} at - Whatever went off, which is only read for its place.
 * @param {Object[]} items - Everything loose, all of which can be thrown.
 * @param {Object[]} crafts - Every craft, which is thrown where its mass allows and hurt.
 */
export const detonate = (blast, items, crafts) => {
  const { x, y } = blast;
  blasts.push({ age: 0, x, y });

  const shove = (object, share) => {
    if (object.mass === undefined) return;

    const away = object.position.subtract(blast.position).normalize();
    const push = (force * share) / object.mass;

    object.velocity.set(object.velocity.add(away.scale(push)));
  };

  items.forEach((item) => {
    const share = shareAt(item.position.distance(blast.position));

    if (!share) return;

    shove(item, share);

    // A blast is enough of a knock to start another one off, so a pocket of
    // them goes up in a chain rather than one at a time
    if (item.item.fuse) item.arm();
  });

  crafts.forEach((craft) => {
    const share = shareAt(craft.position.distance(blast.position));

    if (!share) return;

    shove(craft, share);

    // Worked out for each piece where that piece actually sits, so a blast off
    // to one side stoves in the side of the ship that was facing it
    craft.segments.forEach((segment) => {
      // Shared-health modules are damaged through their parent hull once
      if (segment.healthFrom) return;

      const at = craft.position.add(rotatePoint(segment, craft.rotation));

      craft.damage(segment, damage * shareAt(at.distance(blast.position)));
    });
  });
};

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updateBlasts = (dt) => {
  for (let i = blasts.length - 1; i >= 0; i--) {
    blasts[i].age += dt;

    if (blasts[i].age >= life) blasts.splice(i, 1);
  }
};

/**
 * @param {Object} game
 * @param {Number} scale
 */
export const renderBlasts = ({ ctx }, scale) => {
  blasts.forEach(({ age, x, y }) => {
    const along = age / life;
    // Out fast and slowing as it goes, the way a shell of hot gas does
    const radius = flashReach * Math.sqrt(along);
    const fade = 1 - along;
    const flash = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);

    flash.addColorStop(0, colors.white[2]);
    flash.addColorStop(0.4, colors.yellow[2]);
    flash.addColorStop(1, `${colors.red[0]}0`);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(x, y);
    // Light, so it lifts whatever it goes off over rather than hiding it
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade;
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // A hard edge running ahead of the fill, which is what makes it read as a
    // shock going out rather than a light being turned down
    ctx.globalAlpha = fade * fade;
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.white[2];
    ctx.stroke();
    ctx.restore();
  });
};
