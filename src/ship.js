import { linesPath, shapePath } from './drawing';
import { Sprite } from './sprite';
import { slow } from './vector';

// Segments below this much of their health are "damaged", at 0 destroyed
const damagedAt = 0.5;

// How much of a knock a bare hull gives back. Springier modules say so
// themselves, and a shield is the springiest thing on a ship
const hullBounciness = 0.05;

// Stroke width in game units, whatever size the ship is drawn at
const lineWidth = 3;

// Modules that give no duration of their own switch on and off in a frame
const instantRate = 99;

// Turns a thruster rating into game units a second, squared
const thrustScale = 220;

// Turns thrust against a hull's drag into a top speed in game units a second
const speedScale = 85;

const clamp = (value) => Math.min(1, Math.max(0, value));

/**
 * A shape that never moves only has to be turned into a path once, one that
 * does is rebuilt every frame, and a part can bring a path of its own instead.
 *
 * @param {Object} part
 * @returns {Function} [path] - Takes the segment, gives back a Path2D.
 */
const pathFor = ({ path, points }) => {
  if (Array.isArray(points)) {
    const fixed = shapePath(points);

    return () => fixed;
  }

  return points ? (segment) => shapePath(points(segment)) : path;
};

/**
 * How far a piece reaches from wherever it is fitted, for a first look at
 * whether anything is close enough to be worth checking properly. A shape
 * that keeps changing is nothing solid to hit unless it brings a reach of its
 * own, which is how a shield is hit as its bubble rather than as its dial.
 *
 * @param {Object} part
 * @returns {Function} [radius] - Takes the segment, gives back a distance.
 */
const radiusFor = ({ points, radius }) => {
  if (radius) return radius;

  if (Array.isArray(points)) {
    const reach = Math.max(...points.map(([x, y]) => Math.hypot(x, y)));

    return () => reach;
  }
};

/**
 * Segments are the pieces a ship is drawn and damaged in. Hull segments bring
 * their own points and may carry a shapeless module like the cockpit, while
 * mounted modules bring their points with them and are drawn at the mount.
 *
 * Health comes from whichever of the two knows it. A horn is the same horn on
 * every ship so it brings its own, while a cockpit is cut to fit the ship it
 * is in, so the hull says how much of a beating that segment takes.
 *
 * @param {Object} [shipModule] - Module the segment belongs to.
 * @param {Object} part - Whichever of the two supplies the points.
 * @param {String[]} shades - Colors to draw the segment in.
 * @param {Object} [mount] - Where on the ship the module is mounted.
 */
const makeSegment = (shipModule = {}, part, shades, mount) => {
  const { points } = part;
  const health = part.health ?? shipModule.health;
  const duration = part.activationDuration || shipModule.activationDuration;

  return {
    // Animation state is defined by the module but stored per segment, so
    // two modules on the same ship animate independently of each other
    ...shipModule.state?.(),
    // How far through switching on the segment is, 0 to 1
    anim: 0,
    critical: shipModule.critical,
    health,
    lines: part.lines,
    maxHealth: health,
    module: shipModule,
    // Switched modules wait to be turned on, everything else is always on
    on: !shipModule.switched,
    path: pathFor(part),
    // Each segment is hit-tested separately so it can be damaged on its own
    points,
    // How much of the power it wants the piece is getting, 0 to 1
    power: 1,
    radius: radiusFor(part),
    rate: duration ? 1 / duration : instantRate,
    shades,
    // Barely filled at all, so it does not hide what is behind it
    sheer: part.sheer,
    // Which side of its mount a thruster nozzle sits on
    side: part.side,
    // A module's thrust is shared out between its nozzles, so losing one to a
    // rock costs its share of the push
    thrust: (shipModule.thrust || 0) / (shipModule.parts?.length || 1),
    update: shipModule.update,
    x: mount?.x || 0,
    y: mount?.y || 0,
    // Below the hull for thrusters and scoops, above it for horns and shields
    zIndex: shipModule.zIndex || 0,
  };
};

export class Ship extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.shipData;

    this.cargo = data.cargo;
    this.drag = data.drag;
    this.mass = data.mass;
    this.price = data.price;
    // What the pilot is asking of the ship, set by fly()
    this.forward = false;
    this.turn = 0;
    // Seconds left of a ship seeing itself out of a docking bay
    this.launching = 0;
    // Whatever the ship is sat inside of and being carried around by, if
    // anything, rather than a plain yes or no
    this.dockedTo = null;
    this.localMovement = null;
    this.turnRate = data.turnRate;
    this.segments = data.hullSegments.map((hull) => makeSegment(hull.module, hull, this.shades));
    // Copied, so that fitting a module to one mustang does not fit it to every
    // mustang there is
    this.mounts = data.mounts.map(({ fits, x, y }) => ({ fits, x, y }));

    data.mounts.forEach((mount) => mount.module && this.fit(mount.module));
  }

  get accel() {
    // All that thrust has to shift the hull, so a heavy ship is a sluggish one
    return thrustScale * this.thrust / this.mass;
  }

  get maxSpeed() {
    // Thrust runs out of top speed to give once the hull is dragging as hard
    // as the thrusters push, so a sleeker hull tops out faster
    return speedScale * this.thrust / this.drag;
  }

  get thrust() {
    return this.segments.reduce((total, { health, power, thrust }) => (
      total + (health ? thrust * power : 0)
    ), 0);
  }

  get throttle() {
    // Steering comes out of the thrusters as well, so it fades along with them
    const nozzle = this.segments.find((segment) => segment.thrust);

    return nozzle ? nozzle.power : 1;
  }

  /**
   * Bolt a module onto the first free mounting point that takes it.
   *
   * @param {Object} shipModule
   */
  fit(shipModule) {
    const mount = this.mounts.find(({ fits, module }) => !module && fits.includes(shipModule));

    mount.module = shipModule;
    // Modules like shields fill room that would otherwise have held cargo
    this.cargo -= shipModule.space || 0;

    // A module made of several pieces becomes a segment per piece, so that
    // one thruster of a pair can fire, or be shot off, without the other
    this.segments.push(...(shipModule.parts || [shipModule])
      .map((part) => makeSegment(shipModule, part, this.shades, mount)));

    // Sorting is stable, so segments on the same layer keep the order they
    // were fitted in, and the hull is drawn back to front
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  paint(shipModule, shades) {
    this.segments.forEach((segment) => {
      if (segment.module === shipModule) {
        segment.shades = shades;
      }
    });
  }

  damage(segment, amount) {
    segment.health = Math.max(0, segment.health - amount);

    if (!segment.health && segment.critical) {
      this.destroyed = true;
    }
  }

  /**
   * The ship as the separate solid pieces it is collided with, so that a rock
   * can stove in the cockpit or snap the horn off without touching the rest
   * of it, or as nothing but its shield while that is up. They all share an
   * owner, which is how a ship avoids colliding with its own bits.
   *
   * @returns {Object[]} hitboxes
   */
  hitboxes() {
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const boxes = this.segments
      .filter((segment) => segment.radius && segment.health)
      .map((segment) => ({
        bounciness: segment.module.bounciness ?? hullBounciness,
        outline: segment.points,
        owner: this,
        radius: segment.radius(segment),
        rotation: this.rotation,
        segment,
        // A module is hit where it is bolted on, which swings round with the
        // ship. Hull segments are mounted at nothing, so they sit at its middle
        x: this.x + segment.x * cos - segment.y * sin,
        y: this.y + segment.x * sin + segment.y * cos,
      }))
      // A shield that is down reaches nowhere, so there is nothing to hit
      .filter(({ radius }) => radius);
    // Anything up that covers the ship is the only thing that can be hit, so
    // nothing sheltering behind it has to be checked at all
    const cover = boxes.find(({ segment }) => segment.module.covers);

    return cover ? [cover] : boxes;
  }

  /**
   * Set how much of the power it wants a module is getting, 0 to 1. Whatever
   * it does scales with that, so half fed thrusters push and steer at half
   * strength and burn a smaller flare while they are at it.
   *
   * @param {Object} shipModule
   * @param {Number} power
   */
  supply(shipModule, power) {
    this.segments.forEach((segment) => {
      if (segment.module === shipModule) {
        segment.power = power;
      }
    });
  }

  /**
   * Switch a module on or off. A player calls this off a key press and an AI
   * pilot off whatever it is doing, so neither has to know how modules work.
   *
   * @param {Object} shipModule
   * @param {Boolean} [on] - Left out, the module flips to whatever it is not.
   */
  toggle(shipModule, on) {
    this.segments.forEach((segment) => {
      if (segment.module === shipModule) {
        segment.on = on ?? !segment.on;
      }
    });
  }

  /**
   * Fire the thrusters that push the ship the way its pilot is asking for. A
   * turn fires only the nozzle on the outside of it, so the ship pivots around
   * the other one, and nozzles in the middle of a mount only fire going ahead.
   *
   * @param {Boolean} forward - Whether the ship is accelerating.
   * @param {Number} turn - Negative to turn left, positive to turn right.
   */
  fly(forward, turn) {
    this.forward = forward;
    this.turn = turn;

    this.segments.forEach((segment) => {
      if (segment.module.thrust) {
        segment.on = forward || (turn !== 0 && turn === -segment.side);
      }
    });
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt) {
    this.rotation += this.turn * this.turnRate * this.throttle * dt;

    if (this.forward) {
      // A ship is only ever pushed along its nose, so turning is how it steers
      this.dx += Math.cos(this.rotation) * this.accel * dt;
      this.dy += Math.sin(this.rotation) * this.accel * dt;
    }

    // Space has no drag in it, but flying without any is horrible
    slow(this.velocity, this.mass, this.maxSpeed, dt);

    this.x += this.dx * dt;
    this.y += this.dy * dt;

    this.segments.forEach((segment) => {
      const on = segment.health && segment.on;

      segment.anim = clamp(segment.anim + (on ? dt : -dt) * segment.rate);
      segment.update?.(segment, dt);
    });
  }

  render(scale) {
    const { ctx } = this;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);
    // Round joins bulge past the outline at sharp corners, bevel never does
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth / this.scale;

    this.segments.forEach((segment) => {
      if (!segment.health) return;

      ctx.save();
      ctx.translate(segment.x, segment.y);

      // Damaged segments drop to the darkest shade, and a sheer segment is
      // its brightest one with an alpha nibble on the end of it
      ctx.fillStyle = segment.sheer ?
        `${segment.shades[2]}2` :
        segment.shades[segment.health > segment.maxHealth * damagedAt ? 1 : 0];
      ctx.strokeStyle = segment.shades[2];

      const path = segment.path?.(segment);

      if (path) {
        ctx.fill(path);
        ctx.stroke(path);
      }

      if (segment.lines) {
        ctx.save();
        // Flutes and the like are drawn overlong, so trim them to the shape
        if (path) ctx.clip(path);
        ctx.stroke(linesPath(segment.lines(segment)));
        ctx.restore();
      }

      ctx.restore();
    });

    ctx.restore();
  }
}
