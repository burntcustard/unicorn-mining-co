/**
 * A ship is a hexagonal hull split into eight triangular segments, with six
 * mounting points for modules to be fitted to. There is only the one of them,
 * so its measurements live here rather than in a catalogue of ship types.
 *
 * This is also what a station is built out of (see `station.js`) and what a
 * piece breaking off either of them can become: debris arrives with its
 * segments already made, so it keeps none of the hull below.
 *
 * `modules` is the stable inventory, including fitted and loose instances.
 * An instance's `mount` and the mount's `module` link the two while fitted.
 * `segments` holds the live hull and module geometry; mounts are derived from
 * its hull pieces, and `partsOf` finds the geometry attached to one mount.
 * Neither equipping nor removing changes inventory order.
 */
import {
  cargoScoop,
  floodlight,
  horn,
  scoopOpen,
  shield,
  thrusterDualMd,
  thrusterDualXl,
  thrusterSingle,
  thrusterTriple,
} from './modules';
import { drawBeam, drawDockingBayGlow, drawThrusterGlow, lightAngle, litFill, shapeOf, tint } from './lighting';
import { drawInside, drawSpectrum, litPath, traceBeam } from './prism';
import { forget, game } from './game';
import { linesPath, objectLineWidth, shapePath } from './drawing';
import { movePoint, rotatePoint } from './geometry';
import { Sprite } from './sprite';
import { Vector, type Vector as VectorValue } from './vector';
import { applyForce } from './apply-force';
import { colors } from './colors';
import { fracture } from './mining';
// @ifdef DEBUG
// eslint-disable-next-line no-duplicate-imports -- lights only exists in DEBUG builds
import { lights } from './lighting';
// @endif
import { outerEdges } from './collisions';
import { spray } from './shrapnel';
import {
  type Module,
  type Mount,
  type Outline,
  type Palette,
  type Segment,
  type WorldObject,
} from './types';

type ModuleRecord = Module;
type HullPart = Partial<Segment> & {
  [key: string]: any;
  health: number;
  mounts?: Mount[];
  points?: Outline | ((segment: Segment) => Outline);
};
type ShipData = {
  [key: string]: any;
  hullSegments: HullPart[];
};
type ShipProperties = {
  [key: string]: any;
  position?: VectorValue;
  segments?: Segment[];
  velocity?: VectorValue;
};

export const mustang = {
  cargoSpace: 12,
  drag: 5 / 9,
  mass: 9,
  // name: '', // Was 'Mustang' but was never used
  // price: 0, // Was 2000 but was never used
  radius: 40,
  turnRate: 3,
  hullSegments: [
    { health: 4, points: [[-16, -36], [-4, -36], [-16, -20]] },
    // The wedges the scoops open onto. They stand aside for cargo while the
    // doors are open, which is what lets an item fall in under the hull and
    // into the throat waiting behind them
    {
      health: 10,
      mounts: [{ fits: [cargoScoop], localPosition: Vector(3, -13) }],
      points: [[-4, -36], [20, -12], [-16, -20]],
    },
    { health: 10, points: [[-16, -20], [20, -12], [8, 0]] },
    {
      health: 25,
      // The engine mount: without it there is nothing left to fly
      core: true,
      mounts: [
        {
          fits: [thrusterDualMd, thrusterSingle, thrusterDualXl, thrusterTriple],
          localPosition: Vector(-16, 0),
        },
        { fits: [shield], localPosition: Vector() },
      ],
      points: [[-16, -20], [8, 0], [-16, 20]],
    },
    {
      health: 20,
      // Where the pilot sits, so this is the piece the ship is lost without
      core: true,
      mounts: [
        { fits: [horn], localPosition: Vector(20, 0) },
        { fits: [floodlight], localPosition: Vector(20, 0) },
      ],
      points: [[20, -12], [20, 12], [8, 0]],
    },
    { health: 10, points: [[8, 0], [20, 12], [-16, 20]] },
    {
      health: 10,
      mounts: [{ fits: [cargoScoop], localPosition: Vector(3, 13) }],
      points: [[-16, 20], [20, 12], [-4, 36]],
    },
    { health: 4, points: [[-16, 20], [-4, 36], [-16, 36]] },
  ],
};

const hullBounciness = 0.1; // Default restitution when a segment supplies none.
const thrustScale = 220; // Converts thrust per unit mass into acceleration.
const steeringEase = 0.5; // Forward thrust retained by a nozzle eased during a turn.
const approach = (value: number, target: number, step: number) => (
  value + Math.max(-step, Math.min(step, target - value))
);

export const active = (health: number) => !(health < 1);
export const healthOf = (segment: Segment) => (segment.mount || segment).health;
const centerOf = (segments: Segment[]) => segments.reduce((center, { middle }) =>
  center.add(Vector(...middle!)), Vector()).scale(1 / segments.length);
const outlinesOf = (segments: Segment[]) => segments
  .map(({ points }) => points)
  .filter((points): points is Outline => Array.isArray(points));

const makeSegment = (
  craft: Ship,
  craftModule: ModuleRecord = {},
  part: HullPart,
  mount?: Mount,
): Segment => {
  const { glow, points, unclosed } = part;
  const fixedPoints = Array.isArray(points) ? points : undefined;
  const shape = fixedPoints?.[0] && shapeOf(fixedPoints, mount);

  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one part of it
  const duration = part.activationDuration || craftModule.activationDuration || 0.1;

  if (glow) glow.path ||= shapePath(glow);

  // Hull health starts on the prototype; damage creates the instance's own
  // value. Module parts share their mount's health through healthOf instead.
  return Object.assign(Object.create(part), {
    phase: 0,
    ...shape,
    ...(points && { path: (segment: Segment) => shapePath(
      typeof points === 'function' ? points(segment) : points, unclosed),
    }),
    activationProgress: 0,
    hull: !mount,
    module: craftModule,
    mount,
    active: 0,
    radius: part.radius || (shape && (() => shape.reach)),
    rate: 1 / duration,
    shades: craftModule.shades || craft.shades,
    localPosition: (mount?.localPosition || Vector()).add(Vector(
      0, (part.thrusterNozzleSide || 0) * (craftModule.offset || 0))),
    zIndex: part.zIndex || craftModule.zIndex || craft.zIndex || 0,
  }) as Segment;
};

export const damage = (object: WorldObject, amount: number, point?: number[]) => {
  const segment = (object.segment || object) as Segment;
  const target = segment.mount || segment;
  // Asteroids and items are ground down here too, and carry no module
  const { module } = segment;

  // A module that says so is untouchable in one of its two states: a closed
  // scoop lies flat in the hull, and a raised shield is all energy
  if (module && module.unhurtWhen === segment.active) return;

  if (target.health > 0) {
    target.health -= amount;

    // Half-point mining ticks emit one spark; impact bursts scale with damage.
    for (let i = amount * 2; point && i > 0; i--) {
      spray(point, object.stroke || segment.shades?.[2] || object.fill);
    }

    fracture(segment);
  }

  segment.mounts?.forEach((mount) => {
    if (mount.health) {
      mount.health -= segment.health < 1 ?
        mount.health :
        mount.module && mount.module.disablePhysics ? amount : 0;
    }
  });
};

export class Ship extends Sprite {
  declare cargo: WorldObject[];
  declare cockpit?: Segment;
  declare hullSegments: HullPart[];
  declare mass: number;
  declare modules: ModuleRecord[];
  declare segments: Segment[];
  declare shades: Palette;

  constructor(props: ShipProperties, data: ShipData = mustang) {
    super(props);

    // Debris comes with its pieces already broken off something else. It is
    // worth about the same few seconds however big it was, give or take, so a
    // shipful of it does not all wink out at once
    if (this.segments) {
      this.decay = 1;
      this.health = 9 + Math.random();
      this.mass = this.segments.length;

      return;
    }

    Object.assign(this, data, props, {
      cargo: [],
      forward: 0,
      // Ownership order never changes when an instance is fitted or removed.
      modules: [],
      segments: [],
      turn: 0,
    });
    // Building a hull from nothing is the same job as putting a broken one
    // back together
    this.fixHull();
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
    return (this.cockpit && 17 * this.forwardThrust) || 180;
  }

  get mounts() {
    return this.segments.flatMap((segment) => segment.mounts || []);
  }

  partsOf(mount: Mount) {
    return this.segments.filter((segment) => segment.mount === mount);
  }

  get cargoBay() {
    return this.modules.filter(({ mount }) => !mount);
  }

  // This hull has one engine mount; each nozzle belongs to the same module.
  get engine() {
    return this.modules?.find((module) => module.forwardThrust && module.mount && active(module.mount.health)) || {};
  }

  get forwardThrust() {
    return (this.engine.forwardThrust || 0) * this.launchThrottle ** 2;
  }

  get rotationalThrust() {
    return (this.engine.rotationalThrust || 0) * this.launchThrottle ** 2;
  }

  // Half-size nozzles retain the original quarter-thrust launch coast.
  // Return to full power for the last 0.05 seconds of launch.
  get launchThrottle() {
    return this.launching > 0.05 && this.launching <= 2 ? 0.5 : 1;
  }

  // Fit an owned instance, or pass a falsy module to empty the mount. Replaced
  // instances stay in the inventory and become cargo when their link clears.
  fit(craftModule: ModuleRecord | 0, mount = this.mounts.find(({ fits, module }) =>
    !module && fits.includes(craftModule && craftModule.oneOf))) {
    if (!mount) return;

    this.segments = this.segments.filter((segment) => segment.mount !== mount);
    if (mount.module) mount.module.mount = 0;
    mount.module = craftModule;
    mount.health = craftModule && craftModule.health;

    if (craftModule) {
      craftModule.mount = mount;
      // Taken once, so repainting the hull later does not appear to repaint a
      // module that is already built in the colour it was fitted in
      craftModule.shades ||= this.shades;
      this.segments.push(...craftModule.model!
        .map((part) => makeSegment(this, craftModule, part as HullPart, mount)));
    }

    this.segments.sort((a, b) => a.zIndex - b.zIndex);
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
      }
    });
    this.segments.sort((a, b) => a.zIndex - b.zIndex);
    outerEdges(outlinesOf(hulls));
    // Either core anchors flight and the hull kept attached to it; losing one
    // ends the ship, so which of the two is found here does not matter
    this.cockpit = hulls.find(({ core }) => core);
  }

  /**
   * Throw a group of this ship's segments off as a loose body of its own:
   * rebased around `origin`, carrying the motion it had while attached, and
   * shoved clear along `away`.
   *
   * @param {Object} origin - The fragment's own centre, in this ship's frame.
   * @param {Object[]} segments - The segments it takes with it.
   * @param {Object} own - What each copied segment overrides of its original.
   * @param {Object} away - Which way it is pushed, in this ship's frame.
   */
  spawn(
    origin: VectorValue,
    segments: Segment[],
    own: Partial<Segment>,
    away = origin,
  ) {
    const position = this.position.add(rotatePoint(origin, this.rotation));
    const velocity = this.velocity.add(this.momentum(position));
    const fragment = new Ship({
      velocity,
      rotation: this.rotation,
      segments: segments.map((segment) => Object.assign(Object.create(segment), {
        ...own,
        hitbox: 0,
        localPosition: segment.localPosition.subtract(origin),
      })),
      spin: this.spin,
      position,
    });

    applyForce(fragment, rotatePoint(away, this.rotation).normalize().scale(30),
      Math.random() - 0.5);

    return fragment;
  }

  // A broken module keeps its shape long enough to tumble away as debris,
  // while the original mount is immediately free again for the dock menu.
  detach(mount: Mount) {
    const segments = this.partsOf(mount);

    // Destroyed instances leave the inventory rather than becoming cargo.
    this.destroyed?.(mount.module);
    forget(this.modules, mount.module);
    this.fit(0, mount);
    this.spawn(mount.localPosition, segments, {
      health: 1,
      mount: { health: 1, localPosition: mount.localPosition },
    });
  }

  hitboxes() {
    if (this.dockedTo) return [];

    const boxes = this.segments
      .filter((segment) => segment.radius && active(healthOf(segment)))
      .map((segment) => {
        const { bounciness } = segment.module;
        const points = typeof segment.points === 'function' ?
          segment.points(segment) : segment.points;
        const [middleX, middleY] = segment.middle || [0, 0];
        const position = this.position.add(rotatePoint(
          segment.localPosition.add(Vector(middleX, middleY)), this.rotation));
        const outline = points && Object.assign(
          points.map(([x, y]) => [x - middleX, y - middleY]), { edges: points.edges }) as Outline;

        return Object.assign(segment.hitbox ||= { owner: this, segment }, {
          bounciness: (bounciness?.call ? bounciness(segment) : bounciness) || hullBounciness,
          dockSegment: segment.dockSegment,
          outline,
          // Scoop doors have no mounts, so remain physical open or closed.
          // The cargo-catching throat is non-physical, but still reports contacts.
          // A hull wedge stops colliding once its scoop has visibly opened,
          // leaving the mouth clear for cargo to enter.
          physics:
            !segment.module.disablePhysics &&
            !segment.catches &&
            !segment.mounts?.some((mount) => mount.module && mount.module.scoops &&
              this.partsOf(mount).some((part) => active(healthOf(part)) && part.activationProgress > scoopOpen)),
          radius: segment.radius(segment),
          rotation: this.rotation,
          speed: segment.covers && segment.active > segment.activationProgress && 60,
          position,
        });
      })
      .filter(({ radius }) => radius);
    const drill = boxes.find(({ segment }) => segment.module.grinds);

    if (drill) {
      const [x, y] = (drill.outline as Outline).reduce((far, corner) =>
        corner[0] > far[0] ? corner : far);
      const tip = rotatePoint(Vector(x, y), this.rotation);

      boxes.push({
        owner: this,
        segment: drill.segment,
        physics: false,
        radius: 2,
        position: drill.position.add(tip),
      });
    }

    const cover = boxes.find(({ segment, radius }) => segment.covers && radius >= this.radius);

    return cover ? [cover] : boxes;
  }

  momentum(position: VectorValue) {
    const offset = position.subtract(this.position);

    return Vector(-offset.y * this.spin, offset.x * this.spin);
  }

  fracture(hulls: Segment[], destroyed: boolean, wreckage?: boolean) {
    const center = hulls.length && centerOf(hulls);
    const groups = destroyed ?
        hulls.map((_, i) => [i]) :
        outerEdges(outlinesOf(hulls));
    const core = !destroyed && groups.find((group) =>
      group.includes(hulls.indexOf(this.cockpit)));
    const fragments = groups.filter((group) => group !== core)
      .map((group) => {
        const segments = group.map((i) => hulls[i]);
        const middle = centerOf(segments);

        outerEdges(outlinesOf(segments));

        return this.spawn(middle, segments, wreckage ? { health: 1 } : {},
          middle.subtract(center));
      });

    // Broken pieces are made into temporary wreckage before the intact hull
    // is fractured, so do not let this pass alter the parent ship.
    if (wreckage) return fragments;
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(centerOf(kept).subtract(center), this.rotation);

      applyForce(this, away.normalize().scale(30), Math.random() - 0.5);
    }

    this.segments = this.segments.filter((segment) =>
      kept.includes(segment) || kept.includes(segment.mount?.hull));
    this.modules = this.modules.filter(({ mount }) => !mount || kept.includes(mount.hull));

    if (kept.length) {
      outerEdges(outlinesOf(kept));
    } else {
      this.cargo.forEach((item) => {
        item.position.set(this.position);
        item.velocity.set(this.velocity);
        applyForce(item, movePoint(Vector(), Math.random() * Math.PI * 2, 30), Math.random() - 0.5);
        item.add();
      });
      this.remove();
    }

    return fragments;
  }

  toggle(craftModule: ModuleRecord) {
    this.segments.forEach((segment) => {
      if (segment.module.oneOf === craftModule) segment.active = 1 - segment.active;
    });
  }

  fly(forward: number, turn: number) {
    this.forward = forward;
    this.turn = turn;
    this.segments.forEach((segment) => {
      if (segment.module.forwardThrust) {
        segment.active = turn && segment.thrusterNozzleSide ?
          turn === -segment.thrusterNozzleSide ? 1 : forward * steeringEase :
          forward;
        segment.active *= this.launchThrottle;
      }
    });
  }

  update(dt: number) {
    if (this.cockpit && !this.dockedTo) {
      const push = thrustScale * this.forwardThrust / this.mass * this.forward * dt;
      const rotationalThrust = this.rotationalThrust;
      const targetSpin = this.turn * this.turnRate * rotationalThrust * this.launchThrottle ** 2 / 16;

      this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);
      this.velocity.set(movePoint(this.velocity, this.rotation + this.spin * dt, push));
    }

    this.segments.forEach((segment) => {
      if (this.dockedTo) segment.active = 0;
      const target = active(healthOf(segment)) ? segment.active : 0;

      segment.activationProgress = approach(segment.activationProgress, target, segment.rate * dt);
      segment.module.update?.(segment, dt);
    });

    super.update(dt);

    // A stale contact can still nudge a ship the same update it docks; keep
    // it pinned in its bay regardless. Rotation and spin need no help: they
    // already track the station exactly via localMovement.
    if (this.dockedTo) {
      this.position.set(this.dockedTo.position);
      this.velocity.set(Vector());
      this.spin = 0;
    }

    if (this.cockpit) {
      this.mounts.filter(({ health, module }) => module && !active(health))
        .forEach((mount) => this.detach(mount));
      const all = this.segments.filter(({ hull }) => hull);
      const hulls = all.filter(({ health }) => active(health));
      // Losing either core, the pilot's piece or the engine mount, ends the ship
      const lost = hulls.filter(({ core }) => core).length < 2;

      if (lost || hulls.length < all.length) {
        const broken = all.filter((segment) => !hulls.includes(segment));

        broken.forEach((segment) =>
          this.destroyed?.(segment.module));
        this.fracture(broken, true, true);
        return this.fracture(hulls, lost);
      }
    }
  }

  render(scenery: WorldObject[], zIndex: number) {
    const { ctx } = this;
    // Only the shared thruster-glow layer has a fractional z-index.
    const glow = zIndex % 1;

    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = objectLineWidth;

    // @ifdef DEBUG
    if (lights || glow) {
    // @endif
      if (zIndex === -3 || zIndex === -1 || glow) {
        this.segments.forEach((segment) => {
          if (!(glow ? segment.module.forwardThrust : segment.module.beam) ||
            !segment.activationProgress || !active(healthOf(segment))) return;

          ctx.save();
          ctx.translate(segment.localPosition.x, segment.localPosition.y);

          if (zIndex === -3) segment.prism = traceBeam(this, segment, scenery);

          (glow ? drawThrusterGlow : zIndex === -3 ? drawSpectrum : drawInside)(ctx, segment, segment.prism);

          ctx.restore();
        });
      }
    // @ifdef DEBUG
    }
    // @endif

    if (zIndex === -3 && this.localMovementRadius) {
      ctx.strokeStyle = `${colors.cyan[2]}6`;
      ctx.setLineDash([12, 12]); // [12] works but 12 twice compressed better
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
      ctx.translate(segment.localPosition.x, segment.localPosition.y);

      if (segment.glow && zIndex < 0) {
        // The subtle glow in/around the ship docking bay
        drawDockingBayGlow(ctx, segment.glow.path, segment.shades[2], segment.glow);
      }

      const worn = health < segment.module.health / 2 ? 0 : +!!segment.hull;
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

      if (segment.glow && zIndex > 0) {
        drawDockingBayGlow(ctx, segment.glow.path, segment.shades[2], segment.glow);
      }

      ctx.restore();
    });

    ctx.restore();
  }
}
