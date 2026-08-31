import { Vector, applyForce, movePoint, rotatePoint } from './vector';
import { active, healthOf, relightCraft } from './craft-render';
import { cockpit, scoopOpen } from './modules';
import { Sprite } from './sprite';
import { game } from './game';
import { outerEdges } from './collisions';
import { shapeOf } from './lighting';
import { shapePath } from './drawing';

const hullBounciness = 0.1; // Default restitution when a segment supplies none.
const instantRate = 99; // Near-instant animation rate for modules without a duration.
const thrustScale = 220; // Converts thrust per unit mass into acceleration.
const speedScale = 85; // Converts thrust per unit drag into maximum speed.
const steeringEase = 0.5; // Forward thrust retained by a nozzle eased during a turn.
const approach = (value, target, step) => (
  value + Math.max(-step, Math.min(step, target - value))
);
const centerOf = (segments) => segments.reduce((center, { middle }) =>
  center.add(Vector(...middle)), Vector()).scale(1 / segments.length);

const nozzleLevel = (thrusterNozzleSide, forward, turn) => {
  if (!turn || !thrusterNozzleSide) return forward;

  return turn === -thrusterNozzleSide ? 1 : forward * steeringEase;
};

// A part's optional outline is either fixed points or a function that returns
// points for its current segment, so animated modules can update their shape.
const pathFor = ({ path, points, unclosed }) => {
  if (Array.isArray(points)) {
    const fixed = shapePath(points, unclosed);

    return () => fixed;
  }

  return points ? (segment) => shapePath(points(segment), unclosed) : path;
};

const bounceOf = (segment) => {
  const { bounciness } = segment.module;
  const value = typeof bounciness === 'function' ? bounciness(segment) : bounciness;

  return value ?? hullBounciness;
};

const makeSegment = (craft, craftModule = {}, part, mount) => {
  const { glow, points } = part;
  const shape = Array.isArray(points) && shapeOf(points, mount);
  const health = mount ? undefined : part.health;
  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one part of it
  const duration = part.activationDuration || craftModule.activationDuration || 0.1;

  if (glow) glow.path ||= shapePath(glow);

  return Object.assign(Object.create(part), {
    ...craftModule.state?.(),
    ...shape,
    anim: 0,
    health,
    hull: !mount,
    module: craftModule,
    mount,
    active: 0,
    path: pathFor(part),
    power: 1,
    radius: part.radius || (shape && (() => shape.reach)),
    rate: duration ? 1 / duration : instantRate,
    shades: craftModule.paints?.[craft.mounts.indexOf(mount)] || craftModule.shades || craft.shades,
    forwardThrust: (craftModule.forwardThrust || 0) / (craftModule.model?.length || 1),
    rotationalThrust: (craftModule.rotationalThrust || 0) / (craftModule.model?.length || 1),
    update: craftModule.update,
    x: mount?.x || 0,
    y: (mount?.y || 0) + (part.thrusterNozzleSide || 0) * (craftModule.offset || 0),
    zIndex: part.zIndex ?? craftModule.zIndex ?? craft.zIndex ?? 0,
  });
};

export const damage = (segment, amount) => {
  const target = segment.mount || segment;

  if (target.health) target.health -= amount;
  segment.mounts?.forEach((mount) => {
    if (mount.health) {
      mount.health -= segment.health < 1 ?
        mount.health :
        mount.module.disablePhysics && amount;
    }
  });
};

export class Craft extends Sprite {
  constructor(props) {
    super(props);

    const data = props.craftData;

    if (!data) return;

    Object.assign(this, data, {
      cargo: [],
      forward: 0,
      mounts: [],
      turn: props.turn ?? data.turn ?? 0,
    });
    this.segments = data.hullSegments.map((hull) => {
      const segment = makeSegment(this, hull, hull);

      segment.mounts = (hull.mounts || []).map((mount) => ({ ...mount, hull: segment }));
      this.mounts.push(...segment.mounts);

      return segment;
    });
    outerEdges(this.segments.map(({ points }) => points));
    this.cockpit = this.mounts.find(({ module }) => module === cockpit);
    this.radius = Math.max(...data.hullSegments
      .flatMap(({ points }) => points.map((point) => Vector(...point).length())));

    if (this.hullGradient) relightCraft(this);
  }

  add() {
    super.add();
    game.crafts.push(this);
  }

  remove() {
    super.remove();
    game.crafts.splice(game.crafts.indexOf(this), 1);
  }

  get accel() {
    return this.mass ? thrustScale * this.forwardThrust / this.mass : 0;
  }

  get maxSpeed() {
    return this.lifetime ?
      180 :
        Math.max(
          this.drag ? speedScale * this.forwardThrust / this.drag : 0,
          (this.localMovementRadius || 0) * Math.abs(this.spin),
        );
  }

  get forwardThrust() {
    return this.segments.reduce((total, segment) => (
      total + (active(healthOf(segment)) ? segment.forwardThrust * segment.power : 0)
    ), 0);
  }

  get rotationalThrust() {
    return this.segments.reduce((total, segment) => (
      total + (active(healthOf(segment)) ? segment.rotationalThrust * segment.power : 0)
    ), 0);
  }

  get throttle() {
    const nozzle = this.segments.find((segment) => segment.forwardThrust);

    return nozzle ? nozzle.power : 1;
  }

  // Every mount a pilot can actually fit something to, i.e. every mount bar
  // the cockpit, which is wherever a pilot sits rather than a fittable slot
  get slots() {
    return this.mounts.filter(({ fits }) => fits);
  }

  fit(craftModule, mount = this.mounts.find(({ fits, module }) => !module && fits.includes(craftModule))) {
    if (!mount) return;

    mount.module = craftModule;
    mount.health = craftModule.health;
    mount.segments = craftModule.model
      .map((part) => makeSegment(this, craftModule, part, mount));
    this.segments.push(...mount.segments);
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  unfit(mount) {
    if (!mount.module) return;

    this.segments = this.segments.filter((segment) => !mount.segments.includes(segment));
    mount.module = 0;
    mount.health = 0;
    mount.segments = [];
  }

  hitboxes() {
    if (this.dockedTo) return [];

    const boxes = this.segments
      .filter((segment) => segment.radius && active(healthOf(segment)))
      .map((segment) => {
        const points = segment.points?.call ? segment.points(segment) : segment.points;
        const [middleX, middleY] = segment.middle || [0, 0];
        const position = this.position.add(rotatePoint({
          x: segment.x + middleX,
          y: segment.y + middleY,
        }, this.rotation));
        const outline = points && Object.assign(
          points.map(([x, y]) => [x - middleX, y - middleY]), { edges: points.edges });

        return Object.assign(segment.hitbox ||= { owner: this, segment }, {
          bounciness: bounceOf(segment),
          dockSegment: segment.dockSegment,
          outline,
          physics: !segment.module.disablePhysics && !segment.catches && !segment.mounts?.some(({ module, segments }) => (
            module?.scoops && segments.some((part) => active(healthOf(part)) && part.anim > scoopOpen)
          )),
          radius: segment.radius(segment),
          rotation: this.rotation,
          speed: segment.covers && segment.active > segment.anim && 60,
          x: position.x,
          y: position.y,
        });
      })
      .filter(({ radius }) => radius);
    const cover = boxes.find(({ segment, radius }) => segment.covers && radius >= this.radius);

    return cover ? [cover] : boxes;
  }

  holds(child) {
    return child.dockedTo === this || (this.localMovementRadius &&
      child.position.distanceTo(this.position) <= this.localMovementRadius);
  }

  momentum({ x, y }) {
    return Vector((this.y - y) * this.spin, (x - this.x) * this.spin);
  }

  fracture(hulls, destroyed) {
    const center = hulls.length && centerOf(hulls);

    const groups = destroyed ?
        hulls.map((_, i) => [i]) :
        outerEdges(hulls.map(({ points }) => points));
    const core = !destroyed && groups.find((group) =>
      group.includes(hulls.indexOf(this.cockpit.hull)));
    const fragments = groups.filter((group) => group !== core)
      .map((group) => {
        let segments = group.map((i) => hulls[i]);
        const middle = centerOf(segments);
        const offset = rotatePoint(middle, this.rotation);
        const away = rotatePoint(middle.subtract(center), this.rotation);
        const velocity = this.velocity.add(this.momentum({
          x: this.x + offset.x,
          y: this.y + offset.y,
        }));

        outerEdges(segments.map(({ points }) => points));
        segments = segments.map((segment) => Object.assign(Object.create(segment), {
          hitbox: 0,
          x: segment.x - middle.x,
          y: segment.y - middle.y,
        }));
        const fragment = new Craft({
          drag: 0.2,
          dx: velocity.x,
          dy: velocity.y,
          lifetime: 9 + Math.random(),
          mass: segments.length,
          rotation: this.rotation,
          segments,
          spin: this.spin,
          x: this.x + offset.x,
          y: this.y + offset.y,
        });

        applyForce(fragment, Vector(away).normalize().scale(30), Math.random() - 0.5);
        return fragment;
      });
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(centerOf(kept).subtract(center), this.rotation);

      applyForce(this, Vector(away).normalize().scale(30), Math.random() - 0.5);
    }

    this.segments = this.segments.filter((segment) =>
      kept.includes(segment) || kept.includes(segment.mount?.hull));
    this.mounts = this.mounts.filter(({ hull }) => kept.includes(hull));

    if (kept.length) {
      outerEdges(kept.map(({ points }) => points));
    } else {
      const cockpit = rotatePoint(this.cockpit, this.rotation);
      const position = this.position.add(cockpit);

      this.cargo.forEach((item) => {
        item.position.set(position);
        item.velocity.set(this.velocity);
        item.arm();
        item.add();
      });
      this.remove();
    }

    return fragments;
  }

  supply(craftModule, power) {
    this.segments.forEach((segment) => {
      if (segment.module === craftModule) segment.power = power;
    });
  }

  toggle(craftModule, on) {
    this.segments.forEach((segment) => {
      if (segment.module === craftModule) segment.active = (on ?? !segment.active) ? 1 : 0;
    });
  }

  fly(forward, turn) {
    this.forward = forward;
    this.turn = turn;
    this.segments.forEach((segment) => {
      if (segment.forwardThrust) {
        segment.active = nozzleLevel(segment.thrusterNozzleSide, forward, turn);
      }
    });
  }

  update(dt, movement) {
    if (this.lifetime) {
      if ((this.lifetime -= dt) <= 0) {
        this.remove();
        return;
      }
    } else if (!this.dockedTo) {
      const push = this.accel * this.forward * dt;
      const rotationalThrust = this.rotationalThrust;
      const targetSpin = rotationalThrust ?
        this.turn * this.turnRate * rotationalThrust * this.throttle / 16 :
        this.spin;

      this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);
      this.velocity.set(movePoint(this.velocity, this.rotation + this.spin * dt, push));
    }

    this.segments.forEach((segment) => {
      const level = active(healthOf(segment)) ? segment.active : 0;

      segment.anim = approach(segment.anim, level, segment.rate * dt);
      segment.update?.(segment, dt);
    });

    super.update(dt, movement);

    if (!this.lifetime && this.cockpit) {
      const all = this.segments.filter(({ hull }) => hull);
      const hulls = all.filter(({ health }) => active(health));
      const destroyed = hulls.reduce((sum, { health }) => sum + health, 0) < 30 ||
        !hulls.includes(this.cockpit.hull);

      if (destroyed || hulls.length < all.length) return this.fracture(hulls, destroyed);
    }
  }
}
