import { circlePath, linesPath, shapePath, sparklePath } from './drawing';
import { drawGlow, lightAngle, litFill, tint } from './lighting';
import { Sprite } from './sprite';
import { colors } from './colors';
import { move } from './vector';
import { unplace } from './collisions';

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
// is given, so this is smaller than it looks. `shineAngle` is where on the
// item it sits, in the item's own frame, so it rides round with the stone
const shineSize = 0.2;
const shineOffset = 0.4;
const shineAngle = -Math.PI / 4;

// Bright, but not so solid that it reads as a hole cut in the stone
const shineAlpha = 0.7;

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
    this.mass = itemMass;
    this.drag = itemDrag;
    // The fastest it settles back to on nothing but the speed it was given,
    // having none of a ship's thrusters to work a top speed out of
    this.maxSpeed = itemMaxSpeed;
    this.name = data.name;
    this.price = data.price;
    this.shades = data.shades;
    // A cut item is hit on its corners, a round one on its radius alone
    this.outline = points;
    this.radius = points ? Math.max(...points.map(([x, y]) => Math.hypot(x, y))) : radius;
    this.path = points ? shapePath(points) : circlePath(radius);
    this.lines = lines && linesPath(lines);
    this.shine = data.shine && sparklePath(this.radius * shineSize);
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
   * @returns {Boolean} spent - Whether that finished it off.
   */
  damage(amount) {
    this.health = Math.max(0, this.health - amount);

    return !this.health;
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    this.rotation += this.spin * dt;

    move(this, dt);

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

    // The light stays put while an item tumbles under it, so its ramp is taken
    // in the item's own turned frame, the way a ship's segments are
    const light = lightAngle - this.rotation;

    if (item.glow) {
      const beat = (1 + Math.sin(this.blink)) / 2;

      drawGlow(ctx, this.path, this.shades[2], glowStrength * (1 - glowBeat * (1 - beat)));
    }

    // An item is a body of its own rather than a piece of a bigger one, so the
    // ramp is laid across the middle of it: lit on the side the light is on
    // and shaded on the far side, however it happens to be turned
    const shape = { facing: light + Math.PI / 2, middle: [0, 0], reach: radius };

    if (item.rainbow) {
      // An opal is not a colour, it is the light coming apart across a pale
      // stone, so it runs from its own warm side through white to its own cool
      // one instead of being tinted like everything else
      const towardsX = Math.cos(light) * radius;
      const towardsY = Math.sin(light) * radius;
      const play = ctx.createLinearGradient(towardsX, towardsY, -towardsX, -towardsY);

      play.addColorStop(0, this.shades[4]);
      play.addColorStop(0.35, this.shades[2]);
      play.addColorStop(0.7, colors.cyan[2]);
      play.addColorStop(1, this.shades[3]);

      ctx.fillStyle = play;
    } else {
      ctx.fillStyle = litFill(ctx, shape, light, (along) => tint(this.shades, 2, along));
    }

    ctx.strokeStyle = this.shades[2];

    // Part filled, so that a stone reads as something to see through rather
    // than a shape cut out in colour
    if (item.sheer) ctx.globalAlpha = sheerFill;
    ctx.fill(this.path);
    ctx.globalAlpha = 1;

    ctx.stroke(this.path);

    if (this.lines) ctx.stroke(this.lines);

    if (this.shine) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shineAlpha;
      // Fixed to the stone rather than to the light, so a tumbling item
      // carries its glint round with it instead of the glint sliding about
      ctx.translate(
        Math.cos(shineAngle) * radius * shineOffset,
        Math.sin(shineAngle) * radius * shineOffset,
      );
      // Turned back out of the item's frame so the sparkle keeps its arms
      // square to the world. Left to spin it would pass through being an x
      ctx.rotate(-this.rotation);
      ctx.fillStyle = colors.white[2];
      ctx.fill(this.shine);
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
  unplace(item);
  items.splice(items.indexOf(item), 1);
};
