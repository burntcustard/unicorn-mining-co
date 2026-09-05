import { circlePath, itemLineWidth, linesPath, shapePath, sparklePath } from './drawing';
import { forget, game } from './game';
import { Sprite } from './sprite';
import { Vector } from './vector';
import { colors } from './colors';

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

// Every item is the same weight, so they shove about alike whatever they are
const itemMass = 6;

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
  }

  add() {
    super.add();
    game.items.push(this);
  }

  remove() {
    super.remove();
    forget(game.items, this);
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    if (this.buried) return;

    super.update(dt);
  }

  render() {
    const { ctx, item, radius } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = itemLineWidth;

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
