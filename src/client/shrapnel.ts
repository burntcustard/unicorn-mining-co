import { objectLineWidth } from './drawing';
import { Vector, type Vector as VectorValue } from '../shared/vector';

/** Short streaks thrown from damage contacts in the damaged object's colour. */

const speed = 100;
const spread = 0.5;
const length = 8;

interface Spark {
  color: string;
  velocity: VectorValue;
  // Remaining lifetime in seconds.
  health: number;
  position: VectorValue;
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
  position: VectorValue;
  color: string;
  damage: number;
}) => {
  for (let index = 0; index < damage * 2; index++) {
    spray([position.x, position.y], color);
  }
};

/**
 * Throw some sparks off a point, spraying out every which way.
 *
 * point: Where they come from.
 * color: The colour of the lines of whatever is being damaged.
 */
export const spray = ([x, y]: number[], color: string) => {
  const angle = Math.random() * Math.PI * 2;
  const pace = speed * (1 - Math.random() * spread);

  sparks.push({
    color,
    velocity: Vector(Math.cos(angle) * pace, Math.sin(angle) * pace),
    health: 0.2 + Math.random() * 0.2,
    position: Vector(x, y),
  });
};

/**
 * dt: Seconds since the last update.
 */
export const updateSparks = (dt: number) => {
  for (let i = sparks.length; i--;) {
    const spark = sparks[i];

    if ((spark.health -= dt) > 0) {
      spark.position.set(spark.position.add(spark.velocity.scale(dt)));
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
    const tail = spark.position.subtract(
      spark.velocity.normalize().scale(length),
    );

    ctx.strokeStyle = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.position.x, spark.position.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
  });

  ctx.restore();
};
