import { Vector, movePoint } from './vector';
import { objectLineWidth } from './drawing';

/**
 * Sparks thrown off where a mining horn bites into something: little bright
 * streaks in the colour of whatever is being ground, flung out from the touch
 * and fading as they fly. The horn will one day do to a hull what it does to a
 * asteroid, so this only ever asks for a point and a colour and does not care what
 * threw the sparks off.
 */

// Seconds a spark lasts at most, with some of that taken off at random so no
// two die together
const lifetime = 0.5;

// How fast a spark flies off, in game units a second, and how much slower the
// slowest of them go
const speed = 110;
const spread = 0.6;

// How fast a spark loses its pace as it flies, per frame at sixty of them
const drag = 0.8;

// How long a streak one draws and how wide, in game units. A streak rather than
// a dot is what makes it read as flying rather than sitting there
const length = 8;

export const sparks = [];

/**
 * Throw some sparks off a point, spraying out every which way.
 *
 * @param {Number} x - Where they come from.
 * @param {Number} y
 * @param {String} color - The colour of the lines of whatever is being ground.
 * @param {Number} amount - How many to make. A fraction is rounded to a whole
 *   one at random, so a thin trickle spread over many frames still comes out.
 * @param {Object} [carry] - Something whose own drift the sparks set off with.
 */
export const spray = (x, y, color, amount, carry = {}) => {
  let count = Math.floor(amount) + (Math.random() < amount % 1 ? 1 : 0);

  while (count--) {
    const angle = Math.random() * Math.PI * 2;
    const pace = speed * (1 - Math.random() * spread);
    const velocity = movePoint(carry.velocity || Vector(), angle, pace);

    sparks.push({
      age: 0,
      color,
      dx: velocity.x,
      dy: velocity.y,
      lifetime: lifetime * (0.5 + Math.random() * 0.5),
      x,
      y,
    });
  }
};

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updateSparks = (dt) => {
  const slow = drag ** (dt * 60);

  for (let i = sparks.length; i--;) {
    const spark = sparks[i];

    spark.age += dt;

    if (spark.age >= spark.lifetime) {
      sparks.splice(i, 1);

      continue;
    }

    spark.dx *= slow;
    spark.dy *= slow;
    spark.x += spark.dx * dt;
    spark.y += spark.dy * dt;
  }
};

/**
 * @param {Object} game
 */
export const renderSparks = ({ ctx }) => {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = objectLineWidth;

  sparks.forEach((spark) => {
    const pace = Math.hypot(spark.dx, spark.dy) || 1;
    // Drawn back along the way it is going, so it stretches into a streak
    const tailX = spark.x - (spark.dx / pace) * length;
    const tailY = spark.y - (spark.dy / pace) * length;

    ctx.globalAlpha = 1 - spark.age / spark.lifetime;
    ctx.strokeStyle = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.x, spark.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  });

  ctx.restore();
};
