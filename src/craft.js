import { Vector, movePoint, rotatePoint } from 'kontra';
import {
  drawBeam,
  drawGlow,
  drawHalo,
  lightAngle,
  lights,
  litFill,
  shadingStep,
  shapeOf,
  tint,
} from './lighting';
import { drawSpectrum, litPath, traceBeam } from './prism';
import { linesPath, shapePath } from './drawing';
import { Sprite } from './sprite';
import { colors } from './colors';
import { rotateAround } from './local-movement';
import { scoopOpen } from './modules';

const damagedAt = 0.5;
const hullBounciness = 0.1;
const lineWidth = 3;
const instantRate = 99;
const thrustScale = 220;
const speedScale = 85;
const steeringEase = 0.5;
const glowStrength = 0.15;

const active = (health) => !(health < 1);
const approach = (value, target, step) => (
  value + Math.max(-step, Math.min(step, target - value))
);

const nozzleLevel = (thrusterNozzleSide, forward, turn) => {
  if (!turn || !thrusterNozzleSide) return forward;

  return turn === -thrusterNozzleSide ? 1 : forward * steeringEase;
};

const pathFor = ({ path, points }) => {
  if (Array.isArray(points)) {
    const fixed = shapePath(points);

    return () => fixed;
  }

  return points ? (segment) => shapePath(points(segment)) : path;
};

const bounceOf = (segment) => {
  const { bounciness } = segment.module;
  const value = typeof bounciness === 'function' ? bounciness(segment) : bounciness;

  return value ?? hullBounciness;
};

const healthOf = (segment) => segment.healthFrom?.health ?? segment.health;
const maxHealthOf = (segment) => segment.healthFrom?.maxHealth ?? segment.maxHealth;

const makeSegment = (craft, craftModule = {}, part, mount) => {
  const { glow, points } = part;
  const shape = Array.isArray(points) && shapeOf(points, mount);
  const healthFrom = mount && part.health === undefined && craftModule.health === undefined ?
    mount.hull :
    null;
  const health = healthFrom?.health ?? part.health ?? craftModule.health;
  const duration = part.activationDuration || craftModule.activationDuration;

  if (glow) glow.path ||= shapePath(glow);

  return {
    ...craftModule.state?.(),
    ...shape,
    anim: 0,
    bare: part.bare,
    catches: part.catches,
    docks: part.docks,
    fill: craft.shades[1],
    fillAlpha: part.fillAlpha,
    glow,
    glowColor: glow && craft.shades[2],
    health,
    healthFrom,
    hull: !mount,
    lines: part.lines,
    maxHealth: health,
    module: craftModule,
    mount,
    on: craftModule.switched ? 0 : 1,
    open: part.open ?? craftModule.open,
    path: pathFor(part),
    points,
    power: 1,
    radius: part.radius || (shape && (() => shape.reach)),
    rate: duration ? 1 / duration : instantRate,
    shades: craft.shades,
    thrusterNozzleSide: part.thrusterNozzleSide,
    stroke: craft.shades[2],
    thrust: (craftModule.thrust || 0) / (craftModule.parts?.length || 1),
    update: craftModule.update,
    x: mount?.x || 0,
    y: (mount?.y || 0) + (part.thrusterNozzleSide || 0) * (craftModule.offset || 0),
    zIndex: part.zIndex ?? craftModule.zIndex ?? craft.zIndex ?? 0,
  };
};

export class Craft extends Sprite.class {
  constructor(props) {
    super(props);

    const data = props.craftData;

    this.cargo = [];
    this.cargoSpace = data.cargoSpace;
    this.drag = data.drag;
    this.forward = 0;
    this.hullGradient = data.hullGradient;
    this.localMovementRadius = data.localMovementRadius;
    this.mass = data.mass;
    this.name = data.name;
    this.price = data.price;
    this.spin = 0;
    this.turn = data.turn || 0;
    this.turnRate = data.turnRate;
    this.zIndex = data.zIndex;
    this.mounts = [];
    this.segments = data.hullSegments.map((hull) => {
      const segment = makeSegment(this, {}, hull);

      segment.mounts = (hull.mounts || []).map((mount) => ({ ...mount, hull: segment }));
      this.mounts.push(...segment.mounts);

      return segment;
    });
    this.radius = Math.max(...data.hullSegments
      .flatMap(({ points }) => points.map((point) => Vector(...point).length())));

    if (this.hullGradient) this.relight();
  }

  get accel() {
    return this.mass ? thrustScale * this.thrust / this.mass : 0;
  }

  get maxSpeed() {
    return Math.max(
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
    if (this.cargoSpace) this.cargoSpace -= craftModule.space || 0;
    mount.segments = (craftModule.parts || [craftModule])
      .map((part) => makeSegment(this, craftModule, part, mount));
    this.segments.push(...mount.segments);
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  paint(craftModule, shades) {
    this.segments.forEach((segment) => {
      if (segment.module !== craftModule) return;

      segment.shades = shades;
      segment.fill = this.hullGradient ? `${shades[2]}3` : shades[1];
      segment.stroke = this.hullGradient ? `${shades[2]}d` : shades[2];
      if (segment.glow) segment.glowColor = shades[2];
    });
  }

  damage(segment, amount) {
    const target = segment.healthFrom || segment;

    if (target.health) target.health -= amount;
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

        return Object.assign(segment.hitbox ||= { owner: this, segment }, {
          bounciness: bounceOf(segment),
          docks: segment.docks,
          outline: points?.map(([x, y]) => [x - middleX, y - middleY]),
          physics: !segment.open && !segment.catches && !segment.mounts?.some(({ module, segments }) => (
            module?.scoops && segments.some((part) => active(healthOf(part)) && part.anim > scoopOpen)
          )),
          radius: segment.radius(segment),
          rotation: this.rotation,
          x: position.x,
          y: position.y,
        });
      })
      .filter(({ radius }) => radius);
    const cover = boxes.find(({ segment }) => segment.module.covers);

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

  supply(craftModule, power) {
    this.segments.forEach((segment) => {
      if (segment.module === craftModule) segment.power = power;
    });
  }

  toggle(craftModule, on) {
    this.segments.forEach((segment) => {
      if (segment.module === craftModule) segment.on = (on ?? !segment.on) ? 1 : 0;
    });
  }

  fly(forward, turn) {
    this.forward = forward;
    this.turn = turn;
    this.segments.forEach((segment) => {
      if (segment.thrust) segment.on = nozzleLevel(segment.thrusterNozzleSide, forward, turn);
    });
  }

  update(dt) {
    const push = this.accel * this.forward * dt;
    const targetSpin = this.turn * this.turnRate * this.throttle;

    this.spin = approach(this.spin, targetSpin, this.thrust * dt || Math.abs(targetSpin - this.spin));
    this.velocity.set(movePoint(this.velocity, this.rotation + this.spin * dt, push));
    this.segments.forEach((segment) => {
      const level = active(healthOf(segment)) ? segment.on : 0;

      segment.anim = approach(segment.anim, level, segment.rate * dt);
      segment.update?.(segment, dt);
    });
  }

  relight() {
    const light = lightAngle - this.rotation;

    this.litAt = this.rotation;
    this.segments.forEach((segment) => {
      if (segment.hull && segment.middle) {
        segment.lit = litFill(this.ctx, segment, light, (along) => tint(this.shades, 2, along));
      }
    });
  }

  render(scenery, zIndex) {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth;

    if (zIndex === -3 && this.localMovementRadius) {
      ctx.strokeStyle = `${colors.cyan[2]}4`;
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, this.localMovementRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (lights && this.hullGradient &&
      Math.abs(this.rotation - this.litAt) >= shadingStep) this.relight();

    const light = lightAngle - this.rotation;
    this.segments.forEach((segment) => {
      const health = healthOf(segment);

      if (segment.zIndex !== zIndex || !active(health)) return;

      ctx.save();
      if (segment.thrust && segment.anim) drawHalo(ctx, segment);
      ctx.translate(segment.x, segment.y);
      if (segment.glow && zIndex < 0) {
        drawGlow(ctx, segment.glow.path, segment.glowColor, glowStrength, segment.glow);
      }

      let worn = 0;

      if (!health || health > maxHealthOf(segment) * damagedAt) {
        worn = segment.hull ? 2 : 1;
      }
      let lit;

      if (segment.middle) {
        if (!lights) lit = tint(segment.shades, worn, 0.5);
        else if (this.hullGradient) lit = segment.hull && segment.lit;
        else lit = litFill(ctx, segment, light, (along) => tint(segment.shades, worn, along));
      }

      ctx.fillStyle = segment.fillAlpha ?
        segment.shades[2] + segment.fillAlpha :
        lit || segment.fill || segment.shades[worn];
      ctx.strokeStyle = segment.stroke || segment.shades[2];

      const path = segment.path?.(segment);

      if (path) {
        if (segment.module.beam) {
          if (lights) {
            const beam = traceBeam(this, segment, scenery || []);

            drawBeam(ctx, path, segment.shades[2], segment.module.reach, segment.anim, litPath(beam));
            drawSpectrum(ctx, segment, beam);
          }
        } else {
          ctx.fill(path);
          if (!segment.bare) ctx.stroke(path);
        }
      }

      if (segment.lines) {
        ctx.save();
        if (segment.lines.call) ctx.clip(path);
        ctx.stroke(linesPath(segment.lines.call ? segment.lines(segment) : segment.lines));
        ctx.restore();
      }
      if (segment.glow && zIndex >= 0) {
        drawGlow(ctx, segment.glow.path, segment.glowColor, glowStrength, segment.glow);
      }

      ctx.restore();
    });

    ctx.restore();
  }
}
