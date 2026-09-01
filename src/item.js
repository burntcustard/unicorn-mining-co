import { circlePath, itemLineWidth, linesPath, shapePath, sparklePath } from './drawing';
import { Sprite } from './sprite';
import { Vector } from './vector';
import { colors } from './colors';
import { detonate } from './explosion';
import { drawGlow } from './lighting';
import { game } from './game';

/**
 * One loose thing in the world, built from an item definition. Everything an
 * item needs drawn is worked out once here, so a definition stays nothing but
 * the numbers that make it different from the next one.
 */

// How big a glint is and how far out it sits, both against how far the item
// reaches from its middle. A sparkle's long arms run to four times the size it
// is given, so this is smaller than it looks. Its position is fixed in the
// item's own frame, so it rides round with the stone
const glintSize = 0.3;
const glintOffset = 0.4;
const glintX = 0.3;
const glintY = -0.7;

// How brightly an item that carries its own light burns, how much of that it
// loses between beats, and how fast it beats. A fuse running down winds that
// rate up to `panicRate` on top of its resting speed
const glowStrength = 0.5;
const glowBeat = 0.5;
const calmRate = 3;
const panicRate = 14;

// Every item is the same weight and shrugs off its speed at the same rate, so
// they shove about and drift alike whatever they happen to be
const itemMass = 6;
const itemDrag = 2;

// Fastest an item drifts on nothing but the speed it was given
const itemMaxSpeed = 200;

export class Item extends Sprite {
  constructor(props) {
    super(props);

    const data = props.itemData;
    const { glint, lines, notes, points, radius, shades } = data;

    // What kind of thing this is, which is how anything running into it tells
    // an item from an asteroid without knowing what item it is
    this.item = data;
    Object.assign(this, data);
    this.fill = shades[1];
    this.mass = itemMass;
    this.drag = itemDrag;
    // The fastest it settles back to on nothing but the speed it was given,
    // having none of a ship's thrusters to work a top speed out of
    this.maxSpeed = itemMaxSpeed;
    this.stroke = shades[2];
    // A cut item is hit on its corners, a round one on its radius alone
    this.outline = points;
    this.radius = points ? Math.max(...points.map((point) => Vector(...point).length())) : radius;
    this.path = points ? shapePath(points) : circlePath(radius);
    this.lines = lines && linesPath(lines);
    this.glint = glint && sparklePath(this.radius * glintSize);
    // What a message says is settled when it is made, so two found in the same
    // asteroid do not say the same thing
    this.message = props.message || (notes && notes[Math.floor(Math.random() * notes.length)]);
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

  add() {
    super.add();
    game.items.push(this);
  }

  remove() {
    super.remove();
    game.items.splice(game.items.indexOf(this), 1);
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    if (this.buried) return;

    if (this.fuse && !(this.fuse = Math.max(0, this.fuse - dt))) {
      this.remove();
      detonate(this, game.items, game.crafts);
      return;
    }

    // Quietly while it is still buried, faster the less of the fuse there is
    // left, so the last second of one is unmistakable
    if (this.item.glow) {
      const left = this.fuse === undefined ? 1 : this.fuse / this.item.fuse;

      this.blink += dt * (calmRate + panicRate * (1 - left));
    }

    super.update(dt);
  }

  render() {
    const { ctx, item, radius } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = itemLineWidth;

    if (item.glow) {
      const beat = (1 + Math.sin(this.blink)) / 2;

      drawGlow(ctx, this.path, this.stroke, glowStrength * (1 - glowBeat * (1 - beat)));
    }

    ctx.fillStyle = this.fill + (item.fillAlpha || '');

    if (item.rainbow) {
      const rainbow = ctx.createLinearGradient(-radius, 0, radius, 0);

      rainbow.addColorStop(0, colors.violet[2]);
      rainbow.addColorStop(0.5, colors.yellow[2]);
      rainbow.addColorStop(1, colors.cyan[2]);
      ctx.fillStyle = rainbow;
    }

    ctx.strokeStyle = this.stroke;

    ctx.fill(this.path);

    ctx.stroke(this.path);

    if (this.lines) ctx.stroke(this.lines);

    if (this.glint) {
      ctx.save();
      // Fixed to the stone rather than to the light, so a tumbling item
      // carries its glint round with it instead of the glint sliding about
      ctx.translate(
        glintX * radius,
        glintY * radius * glintOffset,
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
