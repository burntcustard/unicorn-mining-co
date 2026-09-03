/**
 * A ship is a hexagonal hull split into eight triangular segments, with six
 * mounting points for modules to be fitted to. There is only the one of them,
 * so its measurements live here rather than in a catalogue of ship types.
 *
 * This is also what a station is built out of (see `station.js`) and what a
 * piece breaking off either of them becomes: debris arrives with its segments
 * already made, so it keeps none of the hull below.
 */
import { Vector, applyForce, movePoint, rotatePoint } from './vector';
import {
  cargoScoop,
  floodlight,
  horn,
  scoopOpen,
  shield,
  thrusterDualMd,
  thrusterDualXl,
  thrusterSingleXl,
  thrusterTriple,
} from './modules';
import { drawBeam, drawGlow, drawHalo, lightAngle, litFill, shapeOf, tint } from './lighting';
import { drawInside, drawSpectrum, litPath, traceBeam } from './prism';
import { forget, game } from './game';
import { linesPath, objectLineWidth, shapePath } from './drawing';
import { Sprite } from './sprite';
import { colors } from './colors';
// @ifdef DEBUG
// eslint-disable-next-line no-duplicate-imports -- lights only exists in DEBUG builds
import { lights } from './lighting';
// @endif
import { outerEdges } from './collisions';

export const mustang = {
  cargoSpace: 12,
  drag: 5,
  mass: 9,
  name: 'Mustang',
  price: 2000,
  turnRate: 3,
  hullSegments: [
    { health: 5, points: [[-16, -36], [-4, -36], [-16, -20]] },
    // The wedges the scoops open onto. They stand aside for cargo while the
    // doors are open, which is what lets an item fall in under the hull and
    // into the throat waiting behind them
    {
      health: 10,
      mounts: [{ fits: [cargoScoop], x: 3, y: -13 }],
      points: [[-4, -36], [20, -12], [-16, -20]],
    },
    { health: 10, points: [[-16, -20], [20, -12], [8, 0]] },
    {
      health: 15,
      mounts: [
        { fits: [thrusterDualMd, thrusterSingleXl, thrusterDualXl, thrusterTriple], x: -16, y: 0 },
        { fits: [shield], x: 0, y: 0 },
      ],
      points: [[-16, -20], [8, 0], [-16, 20]],
    },
    {
      health: 20,
      // Where the pilot sits, so this is the piece the ship is lost without
      core: true,
      mounts: [
        { fits: [horn], x: 20, y: 0 },
        { fits: [floodlight], x: 20, y: 0 },
      ],
      points: [[20, -12], [20, 12], [8, 0]],
    },
    { health: 10, points: [[8, 0], [20, 12], [-16, 20]] },
    {
      health: 10,
      mounts: [{ fits: [cargoScoop], x: 3, y: 13 }],
      points: [[-16, 20], [20, 12], [-4, 36]],
    },
    { health: 5, points: [[-16, 20], [-4, 36], [-16, 36]] },
  ],
};

const hullBounciness = 0.1; // Default restitution when a segment supplies none.
const glowStrength = 0.15;
const thrustScale = 220; // Converts thrust per unit mass into acceleration.
const speedScale = 85; // Converts thrust per unit drag into maximum speed.
const steeringEase = 0.5; // Forward thrust retained by a nozzle eased during a turn.
const approach = (value, target, step) => (
  value + Math.max(-step, Math.min(step, target - value))
);

export const active = (health) => !(health < 1);
export const healthOf = (segment) =>
  segment.mount?.health ?? segment.mount?.hull?.health ?? segment.health;
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
    activationProgress: 0,
    health,
    hull: !mount,
    module: craftModule,
    mount,
    active: 0,
    path: pathFor(part),
    power: 1,
    radius: part.radius || (shape && (() => shape.reach)),
    rate: 1 / duration,
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
  // Asteroids and items are ground down here too, and carry no module
  const { module } = segment;

  // A module that says so is untouchable in one of its two states: a closed
  // scoop lies flat in the hull, and a raised shield is all energy
  if (module && module.unhurtWhen === segment.active) return;

  if (target.health) target.health -= amount;
  segment.mounts?.forEach((mount) => {
    if (mount.health) {
      mount.health -= segment.health < 1 ?
        mount.health :
        mount.module.disablePhysics ? amount : 0;
    }
  });
};

export class Ship extends Sprite {
  constructor(props, data = mustang) {
    super(props);

    // Debris comes with its pieces already broken off something else. It is
    // worth about the same few seconds however big it was, give or take, so a
    // shipful of it does not all wink out at once
    if (this.segments) {
      this.decay = 1;
      this.drag = 0.2;
      this.health = 9 + Math.random();
      this.mass = this.segments.length;

      return;
    }

    Object.assign(this, data, {
      cargo: [],
      forward: 0,
      // Modules bought but not fitted, riding along in the cargo bay
      cargoBay: [],
      mounts: [],
      segments: [],
      turn: 0,
    });
    // Building a hull from nothing is the same job as putting a broken one
    // back together
    this.fixHull();
    this.radius = Math.max(...data.hullSegments
      .flatMap(({ points }) => points.map((point) => Math.hypot(...point))));
  }

  add() {
    super.add();
    game.crafts.push(this);
  }

  remove() {
    super.remove();
    forget(game.crafts, this);
  }

  // Only a crewed ship flies: debris and stations have no cockpit to fly from
  get maxSpeed() {
    return this.cockpit ? speedScale * this.forwardThrust / this.drag : 180;
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

  // Every mount a pilot can actually fit something to
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

  // Restore the original hull data, including any pieces and mounting points
  // lost when a damaged ship fractured.
  fixHull() {
    const hulls = this.segments.filter(({ hull }) => hull);

    this.hullSegments.forEach((part) => {
      const segment = hulls.find(({ module }) => module === part);

      if (segment) {
        segment.health = part.health;
      } else {
        const rebuilt = makeSegment(this, part, part);

        rebuilt.mounts = (part.mounts || []).map((mount) => ({ ...mount, hull: rebuilt }));
        hulls.push(rebuilt);
        this.segments.push(rebuilt);
        this.mounts.push(...rebuilt.mounts);
      }
    });
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
    outerEdges(hulls.map(({ points }) => points));
    this.cockpit = hulls.find(({ core }) => core);
  }

  // A broken module keeps its shape long enough to tumble away as debris,
  // while the original mount is immediately free again for the dock menu.
  detach(mount) {
    const offset = rotatePoint(mount, this.rotation);
    const position = this.position.add(offset);
    const velocity = this.velocity.add(this.momentum(position));
    const segments = mount.segments.map((segment) => Object.assign(Object.create(segment), {
      health: 1,
      hitbox: 0,
      mount: { health: 1, y: mount.y },
      x: segment.x - mount.x,
      y: segment.y - mount.y,
    }));

    // The copy that broke away is gone, rather than returning to the cargo bay
    this.unfit(mount);
    const fragment = new Ship({
      dx: velocity.x,
      dy: velocity.y,
      rotation: this.rotation,
      segments,
      spin: this.spin,
      x: position.x,
      y: position.y,
    });

    applyForce(fragment, offset.normalize().scale(30), Math.random() - 0.5);
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
            module?.scoops && segments.some((part) => active(healthOf(part)) && part.activationProgress > scoopOpen)
          )),
          radius: segment.radius(segment),
          rotation: this.rotation,
          speed: segment.covers && segment.active > segment.activationProgress && 60,
          x: position.x,
          y: position.y,
        });
      })
      .filter(({ radius }) => radius);
    const cover = boxes.find(({ segment, radius }) => segment.covers && radius >= this.radius);

    return cover ? [cover] : boxes;
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
      group.includes(hulls.indexOf(this.cockpit)));
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
        const fragment = new Ship({
          dx: velocity.x,
          dy: velocity.y,
          rotation: this.rotation,
          segments,
          spin: this.spin,
          x: this.x + offset.x,
          y: this.y + offset.y,
        });

        applyForce(fragment, away.normalize().scale(30), Math.random() - 0.5);
        return fragment;
      });
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(centerOf(kept).subtract(center), this.rotation);

      applyForce(this, away.normalize().scale(30), Math.random() - 0.5);
    }

    this.segments = this.segments.filter((segment) =>
      kept.includes(segment) || kept.includes(segment.mount?.hull));
    this.mounts = this.mounts.filter(({ hull }) => kept.includes(hull));

    if (kept.length) {
      outerEdges(kept.map(({ points }) => points));
    } else {
      this.cargo.forEach((item) => {
        item.position.set(this.position);
        item.velocity.set(this.velocity);
        item.arm();
        item.add();
      });
      this.remove();
    }
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

  update(dt) {
    if (this.cockpit && !this.dockedTo) {
      const push = thrustScale * this.forwardThrust / this.mass * this.forward * dt;
      const rotationalThrust = this.rotationalThrust;
      const nozzle = this.segments.find((segment) => segment.forwardThrust);
      const targetSpin = rotationalThrust ?
        this.turn * this.turnRate * rotationalThrust * (nozzle ? nozzle.power : 1) / 16 :
        this.spin;

      this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);
      this.velocity.set(movePoint(this.velocity, this.rotation + this.spin * dt, push));
    }

    this.segments.forEach((segment) => {
      const target = active(healthOf(segment)) ? segment.active : 0;

      segment.activationProgress = approach(segment.activationProgress, target, segment.rate * dt);
      segment.update?.(segment, dt);
    });

    super.update(dt);

    if (this.cockpit) {
      this.mounts.filter(({ health, module }) => module && !active(health))
        .forEach((mount) => this.detach(mount));
      const all = this.segments.filter(({ hull }) => hull);
      const hulls = all.filter(({ health }) => active(health));
      const destroyed = hulls.reduce((sum, { health }) => sum + health, 0) < 30 ||
        !hulls.includes(this.cockpit);

      if (destroyed || hulls.length < all.length) this.fracture(hulls, destroyed);
    }
  }

  render(scenery, zIndex) {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = objectLineWidth;

    // @ifdef DEBUG
    if (lights) {
    // @endif
      if (zIndex === -3 || zIndex === -1) {
        this.segments.forEach((segment) => {
          if (!segment.module.beam || !segment.activationProgress || !active(healthOf(segment))) return;

          ctx.save();
          ctx.translate(segment.x, segment.y);

          if (zIndex === -3) {
            const beam = segment.prism = traceBeam(this, segment, scenery);

            drawSpectrum(ctx, segment, beam);
          } else {
            drawInside(ctx, segment, segment.prism);
          }

          ctx.restore();
        });
      }
    // @ifdef DEBUG
    }
    // @endif

    if (zIndex === -3 && this.localMovementRadius) {
      ctx.strokeStyle = `${colors.cyan[2]}4`;
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, this.localMovementRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const light = lightAngle - this.rotation;

    this.segments.forEach((segment) => {
      const health = healthOf(segment);

      if (segment.zIndex !== zIndex || !active(health)) return;

      ctx.save();
      if (segment.forwardThrust && segment.activationProgress) drawHalo(ctx, segment);
      ctx.translate(segment.x, segment.y);

      if (segment.glow && zIndex < 0) {
        drawGlow(ctx, segment.glow.path, segment.shades[2], glowStrength, segment.glow);
      }

      const worn = health < segment.module.health / 2 ? 0 : 1 + segment.hull;
      let lit;

      if (segment.middle) {
        // @ifdef DEBUG
        if (!lights) {
          lit = tint(segment.shades, worn, 0.5);
        } else {
        // @endif
          lit = litFill(ctx, segment, light,
            (along) => tint(segment.shades, worn, along));
        // @ifdef DEBUG
        }
        // @endif
      }

      ctx.fillStyle = segment.fillAlpha ?
        segment.shades[2] + segment.fillAlpha :
        lit || segment.shades[worn];
      ctx.strokeStyle = segment.shades[2];

      const path = segment.path?.(segment);

      if (path) {
        if (segment.module.beam) {
          // @ifdef DEBUG
          if (lights) {
          // @endif
            const beam = segment.prism || traceBeam(this, segment, scenery);

            drawBeam(ctx, path, segment.shades[2], segment.module.reach,
              segment.activationProgress, litPath(beam));
          // @ifdef DEBUG
          }
          // @endif
        } else {
          ctx.fill(path);
          ctx.stroke(segment.outline ? linesPath(segment.outline) : path);
        }
      }

      if (segment.lines) {
        ctx.save();
        if (segment.lines.call) ctx.clip(path);
        ctx.stroke(linesPath(segment.lines.call ? segment.lines(segment) : segment.lines));
        ctx.restore();
      }

      if (segment.glow && zIndex >= 0) {
        drawGlow(ctx, segment.glow.path, segment.shades[2], glowStrength, segment.glow);
      }

      ctx.restore();
    });

    ctx.restore();
  }
}
