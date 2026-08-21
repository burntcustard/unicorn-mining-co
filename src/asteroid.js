import { Sprite } from './sprite';
import { createPolygon } from './polygon';
import { distribute } from './distribute';
import { rotateAround } from './local-movement';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// Rock gives a little, but nothing like a shield does
const rockBounciness = 0.2;

// Enough of a wander that no two rocks come out the same shape
const rockVariance = 0.3;

// Next to no drag of its own, so a rock coasts on where a ship soon slows
const rockDrag = 1;

// Fastest a rock settles back to on nothing but the speed it was given
const rockMaxSpeed = 70;

// Bigger rocks need more points to be lumpy with
const pointsFor = (radius) => Math.round(Math.sqrt(radius) / 3) * 2 - 1;

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);
    this.x = props.x;
    this.y = props.y;

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
    this.health = this.radius * 2;
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
    item.x = item.y = undefined;
    this.contents = distribute([...(this.contents || []), item], {
      density: 2,
      width: this.radius,
    });
    this.contents.forEach((content) => {
      content.buried ||= { rotation: Math.random() * Math.PI * 2 };
      Object.assign(content.buried, { x: content.x, y: content.y });
    });
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update() {
    this.contents?.forEach((item) => {
      const { buried } = item;

      Object.assign(item, buried);
      rotateAround(this, item, buried.x, buried.y, this.rotation);
    });
  }

  render() {
    const { ctx } = this;

    ctx.save();
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
