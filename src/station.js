import { linesPath, shapePath } from './drawing';
import { Sprite } from './sprite';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// How much of a knock a bare hull gives back
const hullBounciness = 0.05;

// How far out a station carries ships around with it, as a multiple of how far
// its own hull reaches
const localArea = 3;

/**
 * Segments are the pieces a station is drawn and damaged in, laid out the same
 * way a ship's are: hull segments bring their own points, and mounted modules
 * bring theirs and are drawn wherever they are mounted.
 *
 * @param {Object} [stationModule] - Module the segment belongs to.
 * @param {Object} part - Whichever of the two supplies the points.
 * @param {String[]} shades - Colors to draw the segment in.
 * @param {Object} [mount] - Where on the station the module is mounted.
 */
const makeSegment = (stationModule = {}, part, shades, mount) => ({
  fill: shades[1],
  health: part.health ?? stationModule.health,
  // A bay is left open where its halves meet, so it says which edges to draw
  // rather than having its whole outline stroked
  lines: part.lines && linesPath(part.lines),
  module: stationModule,
  // Ships fly straight through open pieces instead of bumping off them
  open: part.open ?? stationModule.open,
  path: shapePath(part.points),
  points: part.points,
  stroke: shades[2],
  x: mount?.x || 0,
  y: mount?.y || 0,
  // Below zero is drawn behind passing ships, above zero in front of them
  zIndex: part.zIndex || stationModule.zIndex || 0,
});

/**
 * A piece of hull as something to collide with. Its outline is shifted to sit
 * around its own middle rather than the station's, so that a piece out at the
 * rim is a small thing off to one side instead of a huge thing in the middle.
 *
 * @param {Object} segment
 * @param {Object} station
 */
const makeHitbox = (segment, station) => {
  const { points } = segment;
  const middle = points
    .reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
    .map((total) => total / points.length);

  return {
    at: [middle[0] + segment.x, middle[1] + segment.y],
    bounciness: hullBounciness,
    // Open pieces are still reported, they just do not push a ship back out
    open: segment.open,
    outline: points.map(([x, y]) => [x - middle[0], y - middle[1]]),
    owner: station,
    radius: Math.max(...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1]))),
    segment,
  };
};

/**
 * Stations are built out of the same pieces ships are, but they never go
 * anywhere: they sit where they are put and turn on the spot forever.
 */
export class Station extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.stationData;

    this.name = data.name;
    this.turnRate = data.turnRate;
    this.segments = data.hullSegments.map((hull) => makeSegment(hull.module, hull, this.shades));
    // Copied, so that fitting a module to one station does not fit it to
    // every station there is
    this.mounts = data.mounts.map(({ fits, x, y }) => ({ fits, x, y }));

    data.mounts.forEach((mount) => mount.module && this.fit(mount.module));

    // Worked out once, because a station never changes shape and never goes
    // anywhere. Turning on the spot only moves them around
    this.hitboxes = this.segments
      .filter((segment) => segment.health)
      .map((segment) => makeHitbox(segment, this));

    this.localRadius = localArea * Math.max(...data.hullSegments
      .flatMap(({ points }) => points.map(([x, y]) => Math.hypot(x, y))));
  }

  /**
   * Bolt a module onto the first free mounting point that takes it.
   *
   * @param {Object} stationModule
   */
  fit(stationModule) {
    const mount = this.mounts.find(({ fits, module }) => !module && fits.includes(stationModule));

    mount.module = stationModule;

    this.segments.push(...(stationModule.parts || [stationModule])
      .map((part) => makeSegment(stationModule, part, this.shades, mount)));

    // Sorting is stable, so segments on the same layer keep the order they
    // were fitted in
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Modules are see-through, so that a ship sat inside a bay still shows: a
   * nearly solid edge around a floor that is barely there at all.
   *
   * @param {Object} stationModule
   * @param {String[]} color
   */
  paint(stationModule, color) {
    this.segments.forEach((segment) => {
      if (segment.module === stationModule) {
        segment.fill = `${color[2]}3`;
        segment.stroke = `${color[2]}d`;
      }
    });
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    this.rotation += this.turnRate * dt;

    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);

    this.hitboxes.forEach((box) => {
      box.rotation = this.rotation;
      box.x = this.x + box.at[0] * cos - box.at[1] * sin;
      box.y = this.y + box.at[0] * sin + box.at[1] * cos;
    });
  }

  /**
   * @param {Number} scale
   * @param {Boolean} [above] - Draw the pieces that go over the top of passing
   *   ships, rather than the ones that go behind them.
   */
  render(scale, above) {
    const { ctx } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    // Round joins bulge past the outline at sharp corners, bevel never does
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth;

    this.segments.forEach((segment) => {
      // Only what a ship flies in over goes behind it. The hull and everything
      // it can be swallowed by are drawn on top
      const over = segment.zIndex >= 0;

      if (over !== !!above) return;

      ctx.save();
      ctx.translate(segment.x, segment.y);
      ctx.fillStyle = segment.fill;
      ctx.strokeStyle = segment.stroke;
      ctx.fill(segment.path);
      ctx.stroke(segment.lines || segment.path);
      ctx.restore();
    });

    ctx.restore();
  }
}
