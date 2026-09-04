import { movePoint } from './vector';
import { objectLineWidth } from './drawing';

/**
 * Sparks thrown off where a mining horn bites into something: little bright
 * streaks in the colour of whatever is being ground, flung out from the touch
 * and fading as they fly. The horn will one day do to a hull what it does to a
 * asteroid, so this only ever asks for a point and a colour and does not care what
 * threw the sparks off.
 */

const speed = 100;
const spread = 0.6;
const length = 8;

export const sparks = [];

/**
 * Throw some sparks off a point, spraying out every which way.
 *
 * @param {Number} x - Where they come from.
 * @param {Number} y
 * @param {String} color - The colour of the lines of whatever is being ground.
 * @param {Object} [carry] - Something whose own drift the sparks set off with.
 */
export const spray = (x, y, color, carry) => {
  const angle = Math.random() * Math.PI * 2;
  const pace = speed * (1 - Math.random() * spread);
  const velocity = movePoint(carry.velocity, angle, pace);

  sparks.push({
    color,
    dx: velocity.x,
    dy: velocity.y,
    health: 0.2 + Math.random() * 0.2,
    x,
    y,
  });
};

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updateSparks = (dt) => {
  for (let i = sparks.length; i--;) {
    const spark = sparks[i];

    if ((spark.health -= dt) > 0) {
      spark.x += spark.dx * dt;
      spark.y += spark.dy * dt;
    } else {
      sparks.splice(i, 1);
    }
  }
};

/**
 * @param {CanvasRenderingContext2D} ctx - The game-world drawing context.
 */
export const renderSparks = (ctx) => {
  ctx.save();
  ctx.lineWidth = objectLineWidth;

  sparks.forEach((spark) => {
    const pace = Math.hypot(spark.dx, spark.dy);
    // Drawn back along the way it is going, so it stretches into a streak
    const tailX = spark.x - (spark.dx / pace) * length;
    const tailY = spark.y - (spark.dy / pace) * length;

    ctx.strokeStyle = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.x, spark.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  });

  ctx.restore();
};
