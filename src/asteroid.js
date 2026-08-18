import { Sprite } from './sprite';
import { createPolygon } from './polygon';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// Rock gives a little, but nothing like a shield does
const rockBounciness = 0.25;

// Enough of a wander that no two rocks come out the same shape
const rockVariance = 0.5;

// Bigger rocks need more points to be lumpy with
const pointsFor = (radius) => Math.round(4 + Math.sqrt(radius));

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);

    this.bounciness = this.bounciness ?? rockBounciness;

    // A rock never changes shape, so its outline is only worked out the once.
    // Anything else drifting about out there is the same but cut differently
    this.outline = createPolygon({
      points: this.points || pointsFor(this.radius),
      radius: this.radius,
      radiusEven: this.radiusEven,
      variance: this.variance ?? rockVariance,
    });
    // Points that wandered outwards reach further than the radius they were
    // cut from, and a collision check has to know about all of them
    this.radius = Math.max(...this.outline.map(([x, y]) => Math.hypot(x, y)));
    this.path = shapePath(this.outline);
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    this.rotation += this.spin * dt;
    this.x += this.dx * dt;
    this.y += this.dy * dt;
  }

  render(scale) {
    const { ctx } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = this.fill;
    ctx.strokeStyle = this.stroke;
    ctx.fill(this.path);
    ctx.stroke(this.path);
    ctx.restore();
  }
}
