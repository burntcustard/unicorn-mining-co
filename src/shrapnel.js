import { objectLineWidth } from './drawing';

/** Short streaks thrown from damage contacts in the damaged object's colour. */

const speed = 100;
const spread = 0.5;
const length = 8;

export const sparks = [];

/**
 * Throw some sparks off a point, spraying out every which way.
 *
 * @param {Number[]} point - Where they come from.
 * @param {String} color - The colour of the lines of whatever is being damaged.
 */
export const spray = ([x, y], color) => {
  const angle = Math.random() * Math.PI * 2;
  const pace = speed * (1 - Math.random() * spread);

  sparks.push({
    color,
    dx: Math.cos(angle) * pace,
    dy: Math.sin(angle) * pace,
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
