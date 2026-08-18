import { Sprite } from './sprite';
import { createPolygon } from './polygon';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// Rock gives a little, but nothing like a shield does
const rockBounciness = 0.25;

// Enough of a wander that no two rocks come out the same shape
const rockVariance = 0.5;

// How many times over the buried finds are shoved apart each frame, enough to
// settle a small pocket of them out of the middle in one go
const packPasses = 8;

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
   * Tuck an item away in the heart of the rock. Everything buried starts at the
   * very middle and is shoved apart from whatever else is in there, so a rock's
   * finds cluster in its centre rather than sitting on top of one another. A
   * buried item rides along with the rock and stays out of sight until a lamp
   * picks the rock out or a horn grinds it open.
   *
   * @param {Item} item
   */
  bury(item) {
    // Turned to its own angle so a pocket of finds does not line up, and kept
    // so update can work out where in the world each one rides
    item.buried = { rotation: Math.random() * Math.PI * 2, x: 0, y: 0 };

    (this.contents ||= []).push(item);
  }

  /**
   * Shove the buried finds apart from one another so they nestle in the middle
   * of the rock without overlapping. They push against each other and nothing
   * else, and each pair moves apart evenly, so the cluster stays centred.
   */
  packContents() {
    const { contents } = this;

    for (let pass = 0; pass < packPasses; pass++) {
      let moved = false;

      for (let i = 0; i < contents.length; i++) {
        for (let j = i + 1; j < contents.length; j++) {
          const a = contents[i].buried;
          const b = contents[j].buried;
          let awayX = b.x - a.x;
          let awayY = b.y - a.y;
          let between = Math.hypot(awayX, awayY);
          const apart = contents[i].radius + contents[j].radius;

          if (between >= apart) continue;

          // Sat exactly on top of each other, as they are the moment they are
          // buried, so break them apart along any direction at all
          if (!between) {
            const angle = Math.random() * Math.PI * 2;

            awayX = Math.cos(angle);
            awayY = Math.sin(angle);
            between = 1;
          }

          const push = (apart - between) / 2 / between;

          a.x -= awayX * push;
          a.y -= awayY * push;
          b.x += awayX * push;
          b.y += awayY * push;
          moved = true;
        }
      }

      if (!moved) break;
    }
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    this.rotation += this.spin * dt;
    this.x += this.dx * dt;
    this.y += this.dy * dt;

    // Buried cargo is carried bodily by the rock and turns with it, so it sits
    // where the rock's face would be if you could see through to it
    if (this.contents) {
      this.packContents();

      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);

      this.contents.forEach((item) => {
        const { x, y, rotation } = item.buried;

        item.x = this.x + x * cos - y * sin;
        item.y = this.y + x * sin + y * cos;
        item.rotation = this.rotation + rotation;
      });
    }
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
