import { makeSparks, updateSparks } from './particles';
import { colors } from './colors';
import { getContext } from 'kontra';

// Every road sweeps at the same rate and cuts the same width of lane. Only
// where one runs, and how far, is up to the road
const roadSpeed = 400;
const roadWidth = 300;

// How much of its sideways speed a thing keeps each frame while a road has
// hold of it, so that whatever it was doing when it arrived does not carry it
// straight back out of the lane
const sideGrip = 0.95;

// Sparks per square unit of road, so that a longer or wider one gets more of
// them rather than looking emptier. They run at the road's own speed, so
// whatever is being carried keeps pace with them
const sparkDensity = 1 / 6000;

const lineWidth = 2;

// Barely there, just enough to show where the lane runs
const background = `${colors.blue[2]}2`;

/**
 * A road sweeps anything that strays into it along a straight line far faster
 * than it could fly under its own steam. There is nothing to see of one but
 * the sparks running down it.
 */
export class Road {
  constructor(props) {
    this.angle = props.angle;
    this.ctx = getContext();
    this.distance = props.distance;
    this.x = props.x;
    this.y = props.y;
    // A road takes hold of whatever strays into it, rather than being asked,
    // and does the driving once it has, so a ship aboard cuts its engines
    this.grabs = true;
    this.drives = true;
    this.sparks = makeSparks(this.distance * roadWidth * sparkDensity, this.distance);
  }

  /**
   * @param {Object} thing - Anything with a place in the world.
   * @returns {Boolean} inside
   */
  holds({ x, y }) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const dx = x - this.x;
    const dy = y - this.y;
    const along = dx * cos + dy * sin;
    const across = dy * cos - dx * sin;

    return along >= 0 && along <= this.distance && Math.abs(across) <= roadWidth / 2;
  }

  /**
   * @param {Object} thing
   * @param {Number} dt - Seconds since the last update.
   */
  carry(thing, dt) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    // Speed down the road is left alone, and speed across it is reeled in
    const along = thing.dx * cos + thing.dy * sin;
    const across = (thing.dy * cos - thing.dx * sin) * sideGrip ** (dt * 60);

    thing.x += cos * roadSpeed * dt;
    thing.y += sin * roadSpeed * dt;
    thing.dx = along * cos - across * sin;
    thing.dy = along * sin + across * cos;
  }

  /**
   * How fast whatever is aboard is being swept along, which is what it takes
   * with it when it comes off the end.
   *
   * @returns {Number[]} velocity
   */
  momentum() {
    return [Math.cos(this.angle) * roadSpeed, Math.sin(this.angle) * roadSpeed];
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    updateSparks(this.sparks, this.distance, roadSpeed, dt);
  }

  render(scale) {
    const { ctx } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = background;
    ctx.fillRect(0, -roadWidth / 2, this.distance, roadWidth);

    this.sparks.forEach(({ across, along, color, length, life }) => {
      // Fading out over its last second is what stops a spark blinking away
      ctx.globalAlpha = Math.min(1, life);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(along - length, across * roadWidth);
      ctx.lineTo(along, across * roadWidth);
      ctx.stroke();
    });

    ctx.restore();
  }
}
