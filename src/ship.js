import { linesPath, shapePath } from './drawing';
import { Sprite } from './sprite';

// Segments below this are "damaged", at 0 they are destroyed
const damagedAt = 0.5;

// Stroke width in game units, whatever size the ship is drawn at
const lineWidth = 3;

export class Ship extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.shipData;

    this.mass = data.mass;
    this.maxSpeed = data.maxSpeed;
    this.thrust = data.thrust;
    this.turnRate = data.turnRate;

    this.segments = data.segments.map((segment) => {
      const shipModule = segment.module || {};
      const points = segment.points || shipModule.points;

      return {
        // Animation state is defined by the module but stored per segment, so
        // two modules on the same ship animate independently of each other
        ...shipModule.state?.(),
        active: shipModule.active,
        critical: shipModule.critical,
        durability: 1,
        lines: shipModule.lines,
        module: segment.module,
        onlyWhenActive: shipModule.onlyWhenActive,
        // Each segment is hit-tested separately so it can be damaged on its own
        points,
        shades: this.shades,
        shapePath: shapePath(points),
        update: shipModule.update,
      };
    });
  }

  paint(shipModule, shades) {
    this.segments.forEach((segment) => {
      if (segment.module === shipModule) {
        segment.shades = shades;
      }
    });
  }

  damage(segment, amount) {
    segment.durability = Math.max(0, segment.durability - amount);

    if (!segment.durability && segment.critical) {
      this.destroyed = 1;
    }
  }

  update(dt) {
    this.segments.forEach((segment) => {
      if (segment.update && segment.active && segment.durability) {
        segment.update(segment, dt);
      }
    });
  }

  render(scale) {
    const { ctx } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);
    // Round joins bulge past the outline at sharp corners, bevel never does
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth / this.scale;

    this.segments.forEach((segment) => {
      if (!segment.durability || (segment.onlyWhenActive && !segment.active)) {
        return;
      }

      // Damaged segments drop to the darkest shade
      ctx.fillStyle = segment.shades[segment.durability > damagedAt ? 1 : 0];
      ctx.fill(segment.shapePath);

      ctx.strokeStyle = segment.shades[2];
      ctx.stroke(segment.shapePath);

      if (segment.lines) {
        ctx.save();
        ctx.clip(segment.shapePath);
        ctx.stroke(linesPath(segment.lines(segment.phase)));
        ctx.restore();
      }
    });

    ctx.restore();
  }
}
