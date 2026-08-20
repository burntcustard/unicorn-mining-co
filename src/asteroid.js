import { Sprite } from './sprite';
import { contacts } from './collisions';
import { createPolygon } from './polygon';
import { resolve } from './resolve';
import { rotateAround } from './local-movement';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// Rock gives a little, but nothing like a shield does
const rockBounciness = 0.25;

// Enough of a wander that no two rocks come out the same shape
const rockVariance = 0.5;

// Next to no drag of its own, so a rock coasts on where a ship soon slows
const rockDrag = 1;

// Fastest a rock settles back to on nothing but the speed it was given
const rockMaxSpeed = 70;

// Bigger rocks need more points to be lumpy with
const pointsFor = (radius) => Math.round(4 + Math.sqrt(radius));

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);

    this.bounciness = this.bounciness ?? rockBounciness;
    // Drifts like everything else does, just with next to no drag of its own
    this.drag = rockDrag;
    this.maxSpeed = rockMaxSpeed;

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
    // Heft grows with size, so a big rock shrugs off what shoves a pebble and
    // holds its drift far longer
    this.mass = this.radius ** 2;
    this.path = shapePath(this.outline);
  }

  /**
   * Tuck an item away in the heart of the rock. Everything buried starts at the
   * very middle and is settled against the rock's other finds. A buried item
   * rides along with the rock until a horn grinds it open.
   *
   * @param {Item} item
   */
  bury(item) {
    item.buried = { rotation: Math.random() * Math.PI * 2, x: 0, y: 0 };

    (this.contents ||= []).push(item);
  }

  collideContents() {
    const { contents } = this;

    // Collision helpers work in world coordinates, so use the rock's local
    // space as a tiny world while its buried finds settle against one another
    contents.forEach((item) => Object.assign(item, item.buried));

    resolve(contacts(contents));

    contents.forEach((item) => {
      const { buried, x, y } = item;

      Object.assign(buried, { x, y });
      rotateAround(this, item, x, y, this.rotation);
    });
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update() {
    // Buried cargo collides only with the other finds in the same rock
    if (this.contents) {
      this.collideContents();
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
