import { circlePath, linesPath, shapePath, sparklePath } from './drawing';
import { Sprite } from './sprite';
import { colors } from './colors';
import { drawGlow } from './lighting';

/**
 * One loose thing in the world, built from an item definition. Everything an
 * item needs drawn is worked out once here, so a definition stays nothing but
 * the numbers that make it different from the next one.
 */

// Stroke width in game units. Finer than a ship's, because an item is a small
// thing and a heavy outline swallows it
const lineWidth = 2;

// How much of its fill a see-through item keeps
const sheerFill = 0.4;

// How big a glint is and how far out it sits, both against how far the item
// reaches from its middle. A sparkle's long arms run to four times the size it
// is given, so this is smaller than it looks. `glintAngle` is where on the
// item it sits, in the item's own frame, so it rides round with the stone
const glintSize = 0.2;
const glintOffset = 0.4;
const glintAngle = -Math.PI / 4;

// How brightly an item that carries its own light burns, how much of that it
// loses between beats, and how fast it beats. A fuse running down winds that
// rate up to `panicRate` on top of its resting speed
const glowStrength = 0.5;
const glowBeat = 0.5;
const calmRate = 3;
const panicRate = 14;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Every item is the same weight and shrugs off its speed at the same rate, so
// they shove about and drift alike whatever they happen to be
const itemMass = 6;
const itemDrag = 4;

// Fastest an item drifts on nothing but the speed it was given
const itemMaxSpeed = 70;

export class Item extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.itemData;
    const { lines, points, radius } = data;

    // What kind of thing this is, which is how anything running into it tells
    // an item from a rock without knowing what item it is
    this.item = data;
    this.bounciness = data.bounciness;
    this.health = data.health;
    this.fill = data.shades[1];
    this.mass = itemMass;
    this.drag = itemDrag;
    // The fastest it settles back to on nothing but the speed it was given,
    // having none of a ship's thrusters to work a top speed out of
    this.maxSpeed = itemMaxSpeed;
    this.name = data.name;
    this.price = data.price;
    this.stroke = data.shades[2];
    // A cut item is hit on its corners, a round one on its radius alone
    this.outline = points;
    this.radius = points ? Math.max(...points.map(([x, y]) => Math.hypot(x, y))) : radius;
    this.path = points ? shapePath(points) : circlePath(radius);
    this.lines = lines && linesPath(lines);
    this.glint = data.glint && sparklePath(this.radius * glintSize);
    // What a message says is settled when it is made, so two found in the same
    // rock do not say the same thing
    this.message = props.message || (data.notes && pick(data.notes));
    // Sat still unless it was given a tumble. Left undefined it poisons the
    // rotation, and a shape turned by NaN cannot be collided with at all
    this.spin = props.spin || 0;
    // How far through its own beat a glowing item is
    this.blink = 0;
  }

  /**
   * Cut loose from whatever it was buried in. Most items do not care, and an
   * unstable one starts counting down from here.
   */
  arm() {
    if (this.item.fuse) this.fuse = this.item.fuse;
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    if (this.fuse) this.fuse = Math.max(0, this.fuse - dt);

    // Quietly while it is still buried, faster the less of the fuse there is
    // left, so the last second of one is unmistakable
    if (this.item.glow) {
      const left = this.fuse === undefined ? 1 : this.fuse / this.item.fuse;

      this.blink += dt * (calmRate + panicRate * (1 - left));
    }
  }

  render(scale) {
    const { ctx, item, radius } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth;

    if (item.glow) {
      const beat = (1 + Math.sin(this.blink)) / 2;

      drawGlow(ctx, this.path, this.stroke, glowStrength * (1 - glowBeat * (1 - beat)));
    }

    ctx.fillStyle = this.fill;
    if (item.rainbow) {
      const rainbow = ctx.createLinearGradient(-radius, 0, radius, 0);

      rainbow.addColorStop(0, colors.pink[2]);
      rainbow.addColorStop(0.5, colors.yellow[2]);
      rainbow.addColorStop(1, colors.cyan[2]);
      ctx.fillStyle = rainbow;
    }
    ctx.strokeStyle = this.stroke;

    // Part filled, so that a stone reads as something to see through rather
    // than a shape cut out in colour
    if (item.sheer) ctx.globalAlpha = sheerFill;
    ctx.fill(this.path);
    ctx.globalAlpha = 1;

    ctx.stroke(this.path);

    if (this.lines) ctx.stroke(this.lines);

    if (this.glint) {
      ctx.save();
      // Fixed to the stone rather than to the light, so a tumbling item
      // carries its glint round with it instead of the glint sliding about
      ctx.translate(
        Math.cos(glintAngle) * radius * glintOffset,
        Math.sin(glintAngle) * radius * glintOffset,
      );
      // Turned back out of the item's frame so the sparkle keeps its arms
      // square to the world. Left to spin it would pass through being an x
      ctx.rotate(-this.rotation);
      ctx.fillStyle = colors.white[2];
      ctx.fill(this.glint);
      ctx.restore();
    }

    ctx.restore();
  }
}

/**
 * Take an item out of the world for good, whether it was scooped up, shot to
 * pieces, or went off in the pilot's face.
 *
 * @param {Item} item
 * @param {Item[]} items - Everything still out there.
 */
export const remove = (item, items) => {
  const at = items.indexOf(item);

  if (at >= 0) items.splice(at, 1);
};
