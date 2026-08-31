import { Vector, movePoint, rotatePoint } from './vector';
import { makeSparks, updateSparks } from './particles';
import { colors } from './colors';
import { getContext } from './core';

// Every road sweeps at the same rate and cuts the same width of lane. Only
// where one runs, and how far, is up to the road
const roadSpeed = 800;
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
const background = `${colors.cyan[2]}2`;

/**
 * A road sweeps anything that strays into it along a straight line far faster
 * than it could fly under its own steam. There is nothing to see of one but
 * the sparks running down it.
 *
 * ROADS ARE CURRENTLY UNUSED (commented out to save space)
 */
export class Road {
  constructor(props) {
    this.angle = props.angle;
    this.ctx = getContext();
    this.distance = props.distance;
    this.maxSpeed = roadSpeed;
    this.x = props.x;
    this.y = props.y;
    // A road does the driving for whatever it has hold of, so a ship caught on
    // one cuts its own engines. A station carries a ship without driving it
    this.drives = true;
    this.sparks = makeSparks(this.distance * roadWidth * sparkDensity, this.distance);
  }

  /**
   * @param {Object} child - Anything with a place in the world.
   * @returns {Boolean} inside
   */
  holds({ x, y }) {
    const local = rotatePoint({ x: x - this.x, y: y - this.y }, -this.angle);

    return local.x >= 0 && local.x <= this.distance && Math.abs(local.y) <= roadWidth / 2;
  }

  /**
   * @param {Object} child
   * @param {Number} dt - Seconds since the last update.
   */
  carry(child, dt) {
    // Speed down the road is left alone, and speed across it is reeled in
    const velocity = rotatePoint(child.velocity, -this.angle);

    velocity.y *= sideGrip ** (dt * 60);
    child.position.set(movePoint(child.position, this.angle, roadSpeed * dt));
    child.velocity.set(rotatePoint(velocity, this.angle));
  }

  /**
   * How fast whatever is aboard is being swept along, which is what it takes
   * with it when it comes off the end.
   *
   * @returns {Number[]} velocity
   */
  momentum() {
    return movePoint(Vector(), this.angle, roadSpeed);
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    updateSparks(this.sparks, this.distance, roadSpeed, dt);
  }

  render() {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = background;
    ctx.fillRect(0, -roadWidth / 2, this.distance, roadWidth);

    this.sparks.forEach(({ across, along, color, length, lifetime }) => {
      // Fading out over its last second is what stops a spark blinking away
      ctx.globalAlpha = Math.min(1, lifetime);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(along - length, across * roadWidth);
      ctx.lineTo(along, across * roadWidth);
      ctx.stroke();
    });

    ctx.restore();
  }
}
