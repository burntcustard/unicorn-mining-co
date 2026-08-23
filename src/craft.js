import { Vector, movePoint, rotatePoint } from 'kontra';
import { active, healthOf, relightCraft } from './craft-render';
import { cockpit, scoopOpen } from './modules';
import { Sprite } from './sprite';
import { outerEdges } from './collisions';
import { rotateAround } from './local-movement';
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
  const duration = part.activationDuration || craftModule.activationDuration;

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
    shades: craft.shades,
    thrust: (craftModule.thrust || 0) / (craftModule.model?.length || 1),
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

export class Craft extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.craftData;

    Object.assign(this, data, {
      cargo: [],
      forward: 0,
      mounts: [],
      spin: 0,
      turn: data.turn || 0,
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

  get accel() {
    return this.mass ? thrustScale * this.thrust / this.mass : 0;
  }

  get maxSpeed() {
    return this.life ?
      180 :
        Math.max(
          this.drag ? speedScale * this.thrust / this.drag : 0,
          (this.localMovementRadius || 0) * Math.abs(this.spin),
        );
  }

  get thrust() {
    return this.segments.reduce((total, segment) => (
      total + (active(healthOf(segment)) ? segment.thrust * segment.power : 0)
    ), 0);
  }

  get throttle() {
    const nozzle = this.segments.find((segment) => segment.thrust);

    return nozzle ? nozzle.power : 1;
  }

  fit(craftModule) {
    const mount = this.mounts.find(({ fits, module }) => !module && fits.includes(craftModule));

    if (!mount) return;

    mount.module = craftModule;
    mount.health = craftModule.health;
    mount.segments = craftModule.model
      .map((part) => makeSegment(this, craftModule, part, mount));
    this.segments.push(...mount.segments);
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  paint(craftModule, shades) {
    this.segments.forEach((segment) => {
      if (segment.module === craftModule) segment.shades = shades;
    });
  }

  hitboxes() {
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
          docks: segment.docks,
          outline,
          physics: !segment.module.disablePhysics && !segment.catches && !segment.mounts?.some(({ module, segments }) => (
            module?.scoops && segments.some((part) => active(healthOf(part)) && part.anim > scoopOpen)
          )),
          radius: segment.radius(segment),
          rotation: this.rotation,
          x: position.x,
          y: position.y,
        });
      })
      .filter(({ radius }) => radius);
    const cover = boxes.find(({ segment }) => segment.covers);

    return cover ? [cover] : boxes;
  }

  holds(child) {
    return child.dockedTo === this || (this.localMovementRadius &&
      child.position.distance(this.position) <= this.localMovementRadius);
  }

  carry(child, dt) {
    rotateAround(this, child, child.x - this.x, child.y - this.y, this.spin * dt);
  }

  momentum({ x, y }) {
    return Vector((this.y - y) * this.spin, (x - this.x) * this.spin);
  }

  fracture(items) {
    if (!this.cockpit) return [];

    const all = this.segments.filter(({ hull }) => hull);
    const hulls = all.filter(({ health }) => active(health));
    const center = hulls.length && centerOf(hulls);
    const destroyed = hulls.reduce((sum, { health }) => sum + health, 0) < 30 ||
      !hulls.includes(this.cockpit.hull);

    if (!destroyed && hulls.length === all.length) return [];

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
        })).add(Vector(away).normalize().scale(30));

        outerEdges(segments.map(({ points }) => points));
        segments = segments.map((segment) => Object.assign(Object.create(segment), {
          hitbox: 0,
          x: segment.x - middle.x,
          y: segment.y - middle.y,
        }));
        const fragment = Object.assign(new Sprite.class({
          dx: velocity.x,
          dy: velocity.y,
          rotation: this.rotation,
          x: this.x + offset.x,
          y: this.y + offset.y,
        }), {
          drag: 0.2,
          life: 9 + Math.random(),
          mass: segments.length,
          segments,
          spin: this.spin + Math.random() - 0.5,
        });

        Object.setPrototypeOf(fragment, Craft.prototype);
        return fragment;
      });
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(centerOf(kept).subtract(center), this.rotation);

      this.velocity.set(this.velocity.add(Vector(away).normalize().scale(30)));
      this.spin += Math.random() - 0.5;
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
      });
      items.push(...this.cargo);
      this.dead = true;
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
      if (segment.thrust) segment.active = nozzleLevel(segment.thrusterNozzleSide, forward, turn);
    });
  }

  update(dt) {
    if (this.life) {
      if ((this.life -= dt) <= 0) this.dead = true;
    } else {
      const push = this.accel * this.forward * dt;
      const targetSpin = this.turn * this.turnRate * this.throttle;

      this.spin = approach(this.spin, targetSpin,
        this.thrust * dt || (!this.cockpit && Math.abs(targetSpin - this.spin)));
      this.velocity.set(movePoint(this.velocity, this.rotation + this.spin * dt, push));
    }

    this.segments.forEach((segment) => {
      const level = active(healthOf(segment)) ? segment.active : 0;

      segment.anim = approach(segment.anim, level, segment.rate * dt);
      segment.update?.(segment, dt);
    });
  }
}
