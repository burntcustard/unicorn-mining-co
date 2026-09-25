import * as Vec from '../shared/vector';
import { objectLineWidth } from './drawing';

/**
 * Short streaks thrown from damage contacts in the damaged object's colour.
 */

const speed = 100;
const spread = 0.5;
const length = 8;

interface Spark {
  color: string;
  velocity: Vec.Value;
  // Remaining lifetime in seconds.
  health: number;
  position: Vec.Value;
}

export const sparks: Spark[] = [];

/**
 * Present a gameplay damage event without changing its simulation entity.
 */
export const sprayDamage = ({
  position,
  color,
  damage,
}: {
  position: Vec.Value;
  color: string;
  damage: number;
}) => {
  for (let index = 0; index < damage * 2; index++) {
    const angle = Math.random() * Math.PI * 2;
    const pace = speed * (1 - Math.random() * spread);

    sparks.push({
      color,
      velocity: Vec.create(Math.cos(angle) * pace, Math.sin(angle) * pace),
      health: 0.2 + Math.random() * 0.2,
      position: Vec.clone(position),
    });
  }
};

/**
 * dt: Seconds since the last update.
 */
export const updateSparks = (dt: number) => {
  for (let i = sparks.length; i--;) {
    const spark = sparks[i];

    if ((spark.health -= dt) > 0) {
      Vec.addScaled(spark.position, spark.velocity, dt, spark.position);
    } else {
      sparks.splice(i, 1);
    }
  }
};

/**
 * ctx: The game-world drawing context.
 */
export const renderSparks = (ctx: CanvasRenderingContext2D) => {
  ctx.save();
  ctx.lineWidth = objectLineWidth;

  sparks.forEach((spark) => {
    const tail = Vec.subtract(
      spark.position,
      Vec.scale(Vec.normalize(spark.velocity), length),
    );

    ctx.strokeStyle = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.position.x, spark.position.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
  });

  ctx.restore();
};
