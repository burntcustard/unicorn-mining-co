import { makeSparks, updateSparks } from './particles';
import { movePoint, rotatePoint } from '../shared/geometry';
import { Vector, type Vector as VectorValue } from '../shared/vector';
import { colors } from '../shared/colors';
import { getContext } from './core';
import { type GameObject } from '../shared/game-object';

interface RoadSpark {
  across: number;
  along: number;
  color: string;
  length: number;
  lifetime: number;
}

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
  [key: string]: any;

  constructor(props: {
    angle: number;
    distance: number;
    position: VectorValue;
  }) {
    this.angle = props.angle;
    this.ctx = getContext();
    this.distance = props.distance;
    this.maxSpeed = roadSpeed;
    this.position = props.position;
    // A road does the driving for whatever it has hold of, so a ship caught on
    // one cuts its own engines. A station carries a ship without driving it
    this.drives = true;
    this.sparks = makeSparks(
      this.distance * roadWidth * sparkDensity,
      this.distance,
    );
  }

  /**
   * Whether the child's position is inside the road's lane.
   */
  holds(child: Pick<GameObject, 'position'>): boolean {
    const local = rotatePoint(
      child.position.subtract(this.position),
      -this.angle,
    );

    return (
      local.x >= 0 &&
      local.x <= this.distance &&
      Math.abs(local.y) <= roadWidth / 2
    );
  }

  /**
   * dt: Seconds since the last update.
   */
  carry(child: Pick<GameObject, 'position' | 'velocity'>, dt: number): void {
    // Speed down the road is left alone, and speed across it is reeled in
    const velocity = rotatePoint(child.velocity, -this.angle);

    velocity.y *= sideGrip ** (dt * 60);
    child.position.set(movePoint(child.position, this.angle, roadSpeed * dt));
    child.velocity.set(rotatePoint(velocity, this.angle));
  }

  /**
   * How fast whatever is aboard is being swept along, which is what it takes
   * with it when it comes off the end.
   */
  momentum(): VectorValue {
    return movePoint(Vector(), this.angle, roadSpeed);
  }

  /**
   * dt: Seconds since the last update.
   */
  update(dt: number) {
    updateSparks(this.sparks, this.distance, roadSpeed, dt);
  }

  render() {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.rotate(this.angle);
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = background;
    ctx.fillRect(0, -roadWidth / 2, this.distance, roadWidth);

    (this.sparks as RoadSpark[]).forEach(
      ({ across, along, color, length, lifetime }) => {
        // Fading out over its last second is what stops a spark blinking away
        ctx.globalAlpha = Math.min(1, lifetime);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(along - length, across * roadWidth);
        ctx.lineTo(along, across * roadWidth);
        ctx.stroke();
      },
    );

    ctx.restore();
  }
}
