import { drawInside, drawSpectrum, traceBeam } from '../utilities/prism';
import { drawSegment, objectLineWidth } from '../utilities/drawing';
import { game } from '../game';

// @ifdef DEBUG
import { lights } from '../utilities/lighting';

// @endif
import {
  defaultFriction,
  defaultHealth,
  hullBounciness,
  defaultActivationDuration,
  wreckageDecay,
  wreckageHealth,
} from '../../definitions/craft';
import { flight } from '../../definitions/control-ship';
import * as Vec from '../utilities/vector';
import { type WreckageSegment } from './wreckage-segment';
import { cargoHatchOpen, moduleTypes } from './modules/index';
import {
  movePoint,
  shapeOutlineExtent,
  rotatePoint,
  shapeOf,
} from '../utilities/geometry';
import { GameObject, type RenderOptions } from './game-object';
import { colors, shadesOf } from '../../definitions/colors';
import { applyForce } from '../physics/apply-force';
import { outerEdges } from '../utilities/polygon';
import { type Collider } from '../collision/types';
import { cargoContactAllowed } from './modules/cargo-hatch';
import { Module } from './modules/module';
import {
  type Pose,
  type Mount,
  type ShapeOutline,
  type Shades,
  type Segment,
} from '../types';
import { entityId } from '../simulation/world';

export type ModuleState = {
  id?: number;
  type: number;
  mount: number;
  health?: number;
  shades?: readonly string[];
  segments: { active: number; activationProgress: number }[];
};

export interface CraftRenderOptions extends RenderOptions {
  scenery?: GameObject[];
  zIndex?: number;
  drawHull?: (options: {
    segment: Segment;
    health: number;
    pose: Pose;
  }) => void;
}

type ModuleRecord = Module;

type HullSegmentPlan = Partial<Segment> & {
  [key: string]: any;
  health?: number;
  mounts?: Mount[];
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
};

type CraftData = {
  [key: string]: any;
  hullSegments: HullSegmentPlan[];
};

type CraftProperties = {
  [key: string]: any;
  cargoContents?: GameObject[];
  position?: Vec.Value;
  segments?: Segment[];
  velocity?: Vec.Value;
};

const collisionCaches = new WeakMap<
  Craft,
  { colliders: Collider[]; source: object }
>();

const drillColliders = new WeakMap<Segment, Collider>();
const lockedOutlines = new WeakSet<ShapeOutline>();

const collisionOutlines = new WeakMap<
  ShapeOutline,
  { x: number; y: number; shapeOutline: ShapeOutline }
>();

import { approach } from '../utilities/approach';

const centerOf = (segments: Segment[]) =>
  Vec.scale(
    segments.reduce(
      (center, { middle }) => Vec.add(center, Vec.create(...middle!)),
      Vec.create(),
    ),
    1 / segments.length,
  );
const outlinesOf = (segments: Segment[]) =>
  segments
    .map(({ points }) => points)
    .filter((points): points is ShapeOutline => Array.isArray(points));

const makeSegment = (
  craft: Craft,
  craftModule: ModuleRecord | HullSegmentPlan,
  segmentPlan: HullSegmentPlan,
  mount?: Mount,
): Segment => {
  const { points } = segmentPlan;
  const fixedPoints = Array.isArray(points) ? points : undefined;
  const shape = fixedPoints?.[0] && shapeOf(fixedPoints, mount);

  // Model vertices are shared definitions. Edge markings remain mutable;
  // changed geometry supplies another outline, including animated models.
  if (fixedPoints && !lockedOutlines.has(fixedPoints)) {
    fixedPoints.edges ||= fixedPoints.map(() => true);
    fixedPoints.forEach(Object.freeze);
    Object.freeze(fixedPoints);
    lockedOutlines.add(fixedPoints);
  }

  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one segment of it
  const duration =
    segmentPlan.activationDuration ||
    craftModule.activationDuration ||
    defaultActivationDuration;

  // Give hulls and modules the same runtime layout. Blueprint values are
  // copied once instead of making every blueprint a different prototype.
  return Object.assign(
    {
      health: undefined,
      points: undefined,
      mounts: undefined,
      core: undefined,
      disablePhysics: undefined,
      dockSegment: undefined,
      activationDuration: undefined,
      covers: undefined,
      fillAlpha: undefined,
      fillShade: undefined,
      shapeOutline: undefined,
      wreckage: undefined,
      catches: undefined,
      flareSize: undefined,
      thrusterNozzleSide: undefined,
      facing: undefined,
      middle: undefined,
      reach: undefined,
      biting: undefined,
      collider: undefined,
      expandingTick: undefined,
      phase: 0,
      activationProgress: 0,
      hull: false,
      module: undefined,
      mount: undefined,
      active: 0,
      radius: undefined,
      rate: 0,
      shades: undefined,
      localPosition: undefined,
      zIndex: 0,
    },
    segmentPlan,
    {
      phase: 0,
      ...shape,
      activationProgress: 0,
      hull: !mount,
      module: craftModule,
      mount,
      active: 0,
      radius: segmentPlan.radius || (shape && (() => shape.reach)),
      rate: 1 / duration,
      shades: craftModule.shades || craft.shades,
      localPosition: Vec.add(
        mount?.localPosition || segmentPlan.localPosition || Vec.create(),
        Vec.create(
          0,
          (segmentPlan.thrusterNozzleSide || 0) * (craftModule.offset || 0),
        ),
      ),
      zIndex: segmentPlan.zIndex || craftModule.zIndex || craft.zIndex || 0,
    },
  ) as Segment;
};

export class Craft extends GameObject {
  declare cargoContents: GameObject[];
  declare cockpit?: Segment;
  static friction = defaultFriction;
  health = defaultHealth;
  static hullSegments: HullSegmentPlan[] = [];
  declare hullSegments: HullSegmentPlan[];
  kind = 'craft';
  declare mass: number;
  declare playerId?: number;
  declare segments: Segment[];
  static shades = colors.white;
  declare shades: Shades;

  addToScene() {
    this.collections = [game.sprites, game.crafts];
    this.add();
    return this;
  }

  constructor(props: CraftProperties = {}, data?: CraftData) {
    super(props);

    // Debris comes with its pieces already broken off something else. It is
    // worth about the same few seconds however big it was, give or take, so a
    // shipful of it does not all wink out at once
    if (this.segments) {
      this.cargoContents = props.cargoContents || [];
      this.hullSegments = props.hullSegments || [];
      this.decay = wreckageDecay;
      this.health = wreckageHealth + this.random.next();
      this.mass = this.segments.length;

      return;
    }

    Object.assign(this, data, props, {
      cargoContents: props.cargoContents || [],
      forward: 0,
      segments: [],
      turn: 0,
    });

    // Building a hull from nothing is the same job as putting a broken one
    // back together
    this.fixHull();
  }

  // A broken module keeps its shape long enough to tumble away as wreckage,
  // while the original mount is immediately free again for the dock menu.
  detach(mount: Mount) {
    const mountedSegments = this.segmentsAtMount(mount);
    const wreckageSegments = mountedSegments.filter(
      (segment) => segment.wreckage !== false,
    );
    let wreckageMiddle: Vec.Value | undefined;

    const segments = wreckageSegments.map((segment) => {
      const wreckage = segment.wreckage;
      const shape: Segment['points'] =
        wreckage && typeof wreckage === 'object'
          ? (wreckage.points ?? segment.points)
          : segment.points;
      const points = typeof shape === 'function' ? shape(segment) : shape;
      const { middle, reach: radius } = points?.length
        ? shapeOutlineExtent(points)
        : { middle: [0, 0], reach: points ? -Infinity : 0 };

      if (wreckage && typeof wreckage === 'object') {
        if (wreckageSegments.length === 1) {
          wreckageMiddle = Vec.create(middle[0], middle[1]);
        }

        return Object.assign(Object.create(segment), wreckage, {
          points: points?.map(([x, y]) => [x - middle[0], y - middle[1]]),
          fillShade:
            wreckage.fillShade ??
            ((segment.mount || segment).health < segment.module.health / 2
              ? 0
              : 1),
          radius: () => radius,
        });
      }

      return segment;
    });

    const origin = Vec.add(mount.localPosition, wreckageMiddle || Vec.create());

    // Destroyed instances are removed rather than entering cargo contents.
    this.destroyed?.(mount.module);
    const destroyed = mount.module;

    this.fit(0, mount);

    if (destroyed) {
      this.cargoContents = this.cargoContents.filter(
        (object) => object !== destroyed,
      );
    }

    this.spawn(
      origin,
      segments,
      {
        health: 1,
        mount: { health: 1, localPosition: mount.localPosition },
        shades: (destroyed && destroyed.shades) || this.shades,
        ...(wreckageMiddle && { localPosition: Vec.create() }),
      },
      origin,
    );
  }

  // Fit an owned instance, or pass a falsy module to empty the mount. Replaced
  // instances remain owned and enter cargo contents when their link clears.
  fit(
    craftModule: ModuleRecord | 0,
    mount = this.mounts.find(
      ({ fits, module }) =>
        !module && fits.includes(craftModule && craftModule.constructor),
    ),
  ) {
    if (!mount) return;

    if (mount.module === craftModule) return;

    if (craftModule && craftModule.mount && craftModule.mount !== mount) {
      this.fit(0, craftModule.mount);
    }

    this.segments = this.segments.filter((segment) => segment.mount !== mount);

    if (mount.module) {
      mount.module.mount = 0;
      this.cargoContents.push(mount.module);
    }

    mount.module = craftModule;
    mount.health = craftModule && craftModule.health;

    if (craftModule) {
      this.cargoContents = this.cargoContents.filter(
        (object) => object !== craftModule,
      );
      craftModule.mount = mount;
      // Taken once, so repainting the hull later does not appear to repaint a
      // module that is already built in the colour it was fitted in
      craftModule.shades ||= this.shades;
      this.segments.push(
        ...craftModule.model!.map((segmentPlan) =>
          makeSegment(this, craftModule, segmentPlan as HullSegmentPlan, mount),
        ),
      );
    }

    this.segments.sort((a, b) => a.zIndex - b.zIndex);
  }

  // Restore the original hull data, including any pieces and mounting points
  // lost when a damaged ship fractured.
  fixHull() {
    const hulls = this.segments.filter(({ hull }) => hull);

    this.hullSegments.forEach((segmentPlan) => {
      const segment = hulls.find(({ module }) => module === segmentPlan);

      if (segment) {
        segment.health = segmentPlan.health;
      } else {
        const rebuilt = makeSegment(this, segmentPlan, segmentPlan);

        rebuilt.mounts = (segmentPlan.mounts || []).map((mount) => ({
          ...mount,
          hull: rebuilt,
        }));

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

  fracture(hulls: Segment[], destroyed: boolean, wreckage?: boolean) {
    const center = hulls.length && centerOf(hulls);
    const groups = destroyed
      ? hulls.map((_, i) => [i])
      : outerEdges(outlinesOf(hulls));
    const core =
      !destroyed &&
      groups.find((group) => group.includes(hulls.indexOf(this.cockpit)));

    const fragments = groups
      .filter((group) => group !== core)
      .map((group) => {
        const segments = group.map((i) => hulls[i]);
        const middle = centerOf(segments);

        outerEdges(outlinesOf(segments));

        return this.spawn(
          middle,
          segments,
          wreckage ? { health: 1 } : {},
          Vec.subtract(middle, center),
        );
      });

    // Broken pieces are made into temporary wreckage before the intact hull
    // is fractured, so do not let this pass alter the parent ship.
    if (wreckage) return fragments;
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(
        Vec.subtract(centerOf(kept), center),
        this.rotation,
      );

      applyForce(
        this,
        Vec.scale(Vec.normalize(away), 30),
        this.random.next() - 0.5,
      );
    }

    this.segments = this.segments.filter(
      (segment) => kept.includes(segment) || kept.includes(segment.mount?.hull),
    );

    if (kept.length) {
      outerEdges(outlinesOf(kept));
    } else {
      this.cargoContents.splice(0).forEach((object) => {
        object.world = this.world;
        Vec.set(object.position, this.position);
        Vec.set(object.velocity, this.velocity);

        applyForce(
          object,
          movePoint(Vec.create(), this.random.next() * Math.PI * 2, 30),
          this.random.next() - 0.5,
        );
        object.add();
      });

      this.remove();
    }

    return fragments;
  }

  // The hitbox pass already visits every changing point. Its token lets physics
  // reuse fixtures without repeating the geometry scan and coordinate conversion.
  get geometrySource() {
    return collisionCaches.get(this)?.source;
  }

  hitbox(collidingOnly = false) {
    if (this.dockedTo !== undefined && this.dockedTo !== 0) {
      collisionCaches.delete(this);

      return [];
    }

    let changed = false;

    const sin = Math.sin(this.rotation);
    const cos = Math.cos(this.rotation);
    const colliders: Collider[] = [];
    const segments = this.segments;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];

      if (!segment.radius || (segment.mount || segment).health < 1) continue;
      const physics =
        this.physics &&
        !segment.module.disablePhysics &&
        !segment.catches &&
        !(
          segment.module.collectsCargo &&
          !segment.active &&
          !segment.activationProgress
        ) &&
        !segment.mounts?.some(
          (mount) =>
            mount.module &&
            mount.module.collectsCargo &&
            this.segmentsAtMount(mount).some(
              (segment) =>
                !((segment.mount || segment).health < 1) &&
                segment.activationProgress > cargoHatchOpen,
            ),
        );
      const collides =
        physics ||
        segment.dockSegment ||
        (segment.catches &&
          segment.active &&
          segment.activationProgress > cargoHatchOpen);

      if (collidingOnly && !collides) continue;

      const { bounciness, friction } = segment.module;
      const points =
        typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points;
      const middle = segment.middle;
      const middleX = middle ? middle[0] : 0;
      const middleY = middle ? middle[1] : 0;
      const x = segment.localPosition.x + middleX;
      const y = segment.localPosition.y + middleY;
      const collider = (segment.collider ||= { owner: this, segment });
      // Colliders are read within the step, so their position is reused.
      const position = Vec.setXY(
        collider.position || Vec.create(),
        this.position.x + (x * cos - y * sin),
        this.position.y + (x * sin + y * cos),
      );
      const radius = segment.radius(segment);

      changed ||=
        collider.localPosition?.x !== x ||
        collider.localPosition?.y !== y ||
        collider.physics !== physics ||
        collider.role !== (segment.catches ? 'cargoHatch' : undefined) ||
        collider.collisionMargin !== undefined ||
        collider.pickupPoint !== undefined ||
        collider.radius !== radius ||
        Boolean(collider.shapeOutline) !== Boolean(points);
      collider.localPosition = Vec.setXY(
        collider.localPosition || Vec.create(),
        x,
        y,
      );
      let shapeOutline = points ? collider.shapeOutline : undefined;

      if (points && lockedOutlines.has(points)) {
        let cached = collisionOutlines.get(points);

        if (!cached || cached.x !== middleX || cached.y !== middleY) {
          const outline = points.map(([x, y]) => [
            x - middleX,
            y - middleY,
          ]) as ShapeOutline;

          outline.edges = points.edges;
          outline.forEach(Object.freeze);
          Object.freeze(outline);
          cached = { x: middleX, y: middleY, shapeOutline: outline };
          collisionOutlines.set(points, cached);
        }

        changed ||= shapeOutline !== cached.shapeOutline;
        shapeOutline = cached.shapeOutline;
      } else if (points) {
        if (!shapeOutline || Object.isFrozen(shapeOutline)) {
          changed = true;
          shapeOutline = [] as ShapeOutline;
        }

        changed ||= shapeOutline.length !== points.length;
        shapeOutline.length = points.length;

        points.forEach(([x, y], index) => {
          const point = (shapeOutline[index] ||= [0, 0]);

          const localX = x - middleX;
          const localY = y - middleY;

          changed ||= point[0] !== localX || point[1] !== localY;
          point[0] = localX;
          point[1] = localY;
        });

        shapeOutline.edges = points.edges;
      }

      collider.bounciness =
        (bounciness?.call ? bounciness(segment) : bounciness) ?? hullBounciness;
      collider.friction =
        (friction?.call ? friction(segment) : friction) ?? this.friction;
      collider.dockSegment = segment.dockSegment;
      collider.role = segment.catches ? 'cargoHatch' : undefined;
      collider.shapeOutline = shapeOutline;
      collider.collides = Boolean(collides);
      collider.contactFilter = segment.catches
        ? cargoContactAllowed
        : undefined;
      collider.physics = physics;
      collider.radius = radius;
      collider.rotation = this.rotation;
      collider.speed =
        segment.expandingTick !== undefined &&
        segment.expandingTick === this.world?.tick
          ? 60
          : 0;
      collider.position = position;
      const drillTip = segment.module.drillTip;

      if (collider.radius) colliders.push(collider);

      if (drillTip?.radius) {
        let tip = drillColliders.get(segment);
        const localX = segment.localPosition.x + drillTip.position.x;
        const localY = segment.localPosition.y + drillTip.position.y;

        if (!tip) {
          tip = {
            owner: this,
            segment,
            role: 'hornDrill',
            physics: false,
            friction: this.friction,
            position: Vec.create(),
            radius: 0,
            rotation: this.rotation,
          };

          drillColliders.set(segment, tip);
        }

        changed ||=
          tip.localPosition?.x !== localX ||
          tip.localPosition?.y !== localY ||
          tip.radius !== drillTip.radius;
        tip.localPosition = Vec.setXY(
          tip.localPosition || Vec.create(),
          localX,
          localY,
        );
        Vec.setXY(
          tip.position,
          this.position.x + (localX * cos - localY * sin),
          this.position.y + (localX * sin + localY * cos),
        );
        tip.radius = drillTip.radius;
        tip.rotation = this.rotation;
        tip.friction = this.friction;
        tip.collides = Boolean(collides);
        colliders.push(tip);
      }
    }

    const cover = colliders.find(
      ({ segment, radius }) => segment.covers && radius >= this.radius,
    );
    const result = cover ? [cover] : colliders;
    let cached = collisionCaches.get(this);

    if (!cached) {
      cached = { colliders: [], source: {} };
      collisionCaches.set(this, cached);
    }

    if (
      changed ||
      result.length !== cached.colliders.length ||
      result.some((collider, index) => collider !== cached.colliders[index])
    ) {
      cached.source = {};
    }

    cached.colliders = result;
    return result;
  }

  get hullHealth() {
    // First hull segment per plan, found in one pass rather than per plan.
    const hulls = new Map<unknown, Segment>();

    for (const segment of this.segments) {
      if (segment.hull && !hulls.has(segment.module)) {
        hulls.set(segment.module, segment);
      }
    }

    return this.hullSegments.map((segmentPlan) =>
      segmentPlan.health === undefined
        ? -1
        : hulls.get(segmentPlan)?.health || 0,
    );
  }

  set hullHealth(values: number[]) {
    const current = this.hullHealth;

    if (
      current.length === values.length &&
      current.every((health, index) => health === values[index]) &&
      !this.segments.some(
        (segment) =>
          (segment.hull ? segment : segment.mount?.hull || segment).health < 1,
      )
    ) {
      return;
    }

    // Restoring a checkpoint changes geometry without spawning another copy
    // of the wreckage already present in the authoritative entity list.
    this.fixHull();

    this.hullSegments.forEach((segmentPlan, index) => {
      const segment = this.segments.find(
        (segment) => segment.hull && segment.module === segmentPlan,
      );

      if (segment && segmentPlan.health !== undefined) {
        segment.health = values[index];
      }
    });

    this.segments = this.segments.filter(
      (segment) =>
        !((segment.hull ? segment : segment.mount?.hull || segment).health < 1),
    );
    this.cockpit = this.segments.find(
      (segment) => segment.hull && segment.core,
    );
  }

  launch() {
    this.dockedTo = undefined;
    this.launching = flight.launchDuration;
  }

  moduleActive({ module }: { module: typeof Module }) {
    return this.segments.some(
      (segment) =>
        segment.module instanceof module &&
        !((segment.mount || segment).health < 1) &&
        Boolean(segment.active),
    );
  }

  get modules(): Module[] {
    const modules: Module[] = [];

    for (const segment of this.segments) {
      if (!segment.mounts) continue;

      for (const mount of segment.mounts) {
        if (mount.module) modules.push(mount.module);
      }
    }

    for (const object of this.cargoContents) {
      if (object instanceof Module) modules.push(object);
    }

    return modules;
  }

  get moduleStates(): ModuleState[] {
    const mounts = this.mounts;

    return this.modules.map((module) => ({
      id: module.id,
      type: moduleTypes.findIndex((Type) => module instanceof Type),
      mount: mounts.indexOf(module.mount),
      health: module.mount ? module.mount.health : module.health,
      shades: module.shades,
      segments: this.segmentsAtMount(module.mount)
        .filter((segment) => segment.module === module)
        .map((segment) => ({
          active: segment.active,
          activationProgress: segment.activationProgress,
        })),
    }));
  }

  set moduleStates(states: ModuleState[]) {
    const previous = this.modules;
    const mounts = this.mounts;

    const unchanged =
      previous.length === states.length &&
      states.every((state, index) => {
        const module = previous[index];

        return (
          (state.id === undefined || module.id === state.id) &&
          moduleTypes.findIndex((Type) => module instanceof Type) ===
            state.type &&
          mounts.indexOf(module.mount) === state.mount
        );
      });

    if (!unchanged) {
      mounts.forEach((mount) => this.fit(0, mount));
      this.cargoContents = this.cargoContents.filter(
        (object) => !(object instanceof Module),
      );
    }

    states.forEach((state, index) => {
      const definition = moduleTypes[state.type];

      if (!definition) throw new Error('Unknown ship module');
      const module: Module = unchanged ? previous[index] : new definition();

      if (state.id !== undefined) module.id = state.id;
      module.health = state.mount >= 0 ? definition.health : state.health;

      if (state.shades) module.shades = shadesOf(state.shades);

      if (state.mount >= 0) {
        const mount = mounts[state.mount];

        if (mount) {
          if (!unchanged) this.fit(module, mount);
          mount.health = state.health;

          this.segmentsAtMount(mount).forEach((segment, index) =>
            Object.assign(segment, state.segments[index], {
              shades: module.shades || this.shades,
            }),
          );
        }
      } else if (!unchanged) this.cargoContents.push(module);
    });
  }

  momentum(position: Vec.Value) {
    const offset = Vec.subtract(position, this.position);

    return Vec.create(-offset.y * this.spin, offset.x * this.spin);
  }

  get mounts() {
    const mounts: Mount[] = [];
    const segments = this.segments;

    for (let index = 0; index < segments.length; index++) {
      const segmentMounts = segments[index].mounts;

      for (let at = 0; segmentMounts && at < segmentMounts.length; at++) {
        mounts.push(segmentMounts[at]);
      }
    }

    return mounts;
  }

  render({
    scenery = [],
    zIndex = 0,
    draw,
    drawHull,
    pose = this,
  }: CraftRenderOptions = {}) {
    const { ctx } = game;
    // Only the shared thruster-glow layer has a fractional z-index.
    const glow = zIndex % 1;

    super.render({
      pose,
      draw: () => {
        ctx.lineJoin = 'bevel';
        ctx.lineWidth = objectLineWidth;

        // @ifdef DEBUG
        if (lights || glow) {
          // @endif
          if (!this.decay && (zIndex === -3 || zIndex === -1 || glow)) {
            this.segments.forEach((segment: Segment) => {
              if (
                !(glow ? segment.module.forwardThrust : segment.module.beam) ||
                !segment.activationProgress ||
                (segment.mount || segment).health < 1
              ) {
                return;
              }

              ctx.save();
              ctx.translate(segment.localPosition.x, segment.localPosition.y);

              if (zIndex === -3) {
                segment.prism = traceBeam(pose, segment, scenery);
              }

              if (glow) segment.module.renderGlow({ segment });
              else {
                (zIndex === -3 ? drawSpectrum : drawInside)(
                  ctx,
                  segment,
                  segment.prism,
                );
              }

              ctx.restore();
            });
          }
          // @ifdef DEBUG
        }
        // @endif

        draw?.();

        this.segments.forEach((segment: Segment) => {
          const health = (segment.mount || segment).health;

          if (segment.zIndex !== zIndex || health < 1) return;

          ctx.save();
          ctx.translate(segment.localPosition.x, segment.localPosition.y);

          segment.shades ||= segment.module.shades || this.shades;

          if (!this.decay && segment.module instanceof Module) {
            segment.module.render({ segment, craft: this, scenery, pose });
          } else if (drawHull) drawHull({ segment, health, pose });
          else this.renderHull({ segment, health });

          ctx.restore();
        });
      },
    });
  }

  /*
   * Detached hulls use the bare Craft presentation.
   */
  private renderHull({
    segment,
    health,
  }: {
    segment: Segment;
    health: number;
  }) {
    const { ctx } = game;
    const worn =
      segment.fillShade ??
      (health < segment.module.health / 2 ? 0 : +!!segment.hull);

    ctx.fillStyle = segment.fillAlpha
      ? segment.shades[2] + segment.fillAlpha
      : segment.shades[worn];
    ctx.strokeStyle = segment.shades[2];
    drawSegment({ ctx, segment });
  }

  segmentsAtMount(mount: Mount) {
    return this.segments.filter((segment) => segment.mount === mount);
  }

  setModuleActive({
    module,
    active: enabled,
  }: {
    module: typeof Module;
    active: boolean;
  }) {
    this.segments.forEach((segment) => {
      if (segment.module instanceof module) segment.active = Number(enabled);
    });
  }

  /**
   * Throw a group of this ship's segments off as a loose body of its own:
   * rebased around `origin`, carrying the motion it had while attached, and
   * shoved clear along `away`.
   *
   * origin: The fragment's own centre, in this ship's frame.
   * segments: The segments it takes with it.
   * own: What each copied segment overrides of its original.
   * away: Which way it is pushed, in this ship's frame.
   */
  spawn(
    origin: Vec.Value,
    segments: Segment[],
    own: Partial<Segment>,
    away = origin,
  ) {
    const position = Vec.add(this.position, rotatePoint(origin, this.rotation));
    const velocity = Vec.add(this.velocity, this.momentum(position));

    const fragment = new Craft({
      id: this.world ? entityId(this.world) : undefined,
      world: this.world,
      collections: this.collections,
      random: this.random,
      shades: own.shades || this.shades,
      velocity,
      rotation: this.rotation,
      segments: segments.map((segment) =>
        Object.assign(Object.create(segment), {
          ...own,
          collider: 0,
          localPosition:
            own.localPosition || Vec.subtract(segment.localPosition, origin),
        }),
      ),
      spin: this.spin,
      position,
    });

    applyForce(
      fragment,
      Vec.scale(Vec.normalize(rotatePoint(away, this.rotation)), 30),
      this.random.next() - 0.5,
    );

    fragment.add();
    return fragment;
  }

  toggle(craftModule: typeof Module) {
    this.segments.forEach((segment) => {
      if (segment.module instanceof craftModule) {
        segment.active = 1 - segment.active;
      }
    });
  }

  update(dt: number) {
    this.updateModules(dt);

    super.update(dt);

    // A stale contact can still nudge a ship the same update it docks; keep
    // it pinned in its bay regardless. Rotation and spin need no help: they
    // already track the station exactly via localMovement.
    if (this.dockedTo) {
      const station =
        typeof this.dockedTo === 'number'
          ? this.world?.entities.get(this.dockedTo)
          : this.dockedTo;

      if (station) {
        Vec.set(this.position, station.position);
        this.rotation = station.rotation;
      }

      Vec.set(this.velocity, Vec.create());
      this.spin = 0;
    }

    if (this.cockpit) {
      // Count first; most ticks nothing is broken and nothing is allocated.
      const segments = this.segments;
      let brokenMount = false;
      let brokenHull = false;
      let cores = 0;

      for (let index = 0; index < segments.length; index++) {
        const { hull, health, core, mounts } = segments[index];

        for (let at = 0; mounts && at < mounts.length; at++) {
          brokenMount ||= !!mounts[at].module && mounts[at].health < 1;
        }

        if (hull) {
          if (health < 1) brokenHull = true;
          else if (core) cores++;
        }
      }

      if (!brokenMount && cores >= 2 && !brokenHull) return;
      this.mounts
        .filter(({ health, module }) => module && health < 1)
        .forEach((mount) => this.detach(mount));
      const all = this.segments.filter(({ hull }) => hull);
      const hulls = all.filter(({ health }) => !(health < 1));
      // Losing either core, the pilot's piece or the engine mount, ends the ship
      const lost = hulls.filter(({ core }) => core).length < 2;

      if (lost || hulls.length < all.length) {
        const broken = all.filter((segment) => !hulls.includes(segment));

        broken.forEach((segment) => this.destroyed?.(segment.module));
        this.fracture(broken, true, true);
        this.fracture(hulls, lost);
      }
    }
  }

  updateModules(dt: number) {
    this.segments.forEach((segment) => {
      if (this.dockedTo) segment.active = 0;
      const target = !((segment.mount || segment).health < 1)
        ? segment.active
        : 0;

      const previousProgress = segment.activationProgress;

      segment.activationProgress = approach(
        previousProgress,
        target,
        segment.rate * dt,
      );

      if (segment.covers && segment.activationProgress > previousProgress) {
        segment.expandingTick = this.world?.tick;
      }
    });
  }

  updateVisual(dt: number) {
    this.modules.forEach((module: Module) =>
      module.updateVisual?.({
        dt,
        segments: this.segmentsAtMount(module.mount),
      }),
    );
  }

  get wreckage(): WreckageSegment[] | undefined {
    return this.decay
      ? this.segments.map((segment) => ({
          shapeOutline:
            typeof segment.points === 'function'
              ? segment.points(segment)
              : segment.points,
          radius: segment.radius?.(segment) || 0,
          offset: segment.localPosition,
          health: (segment.mount || segment).health,
          fillShade: segment.fillShade,
          stroke: segment.shapeOutline,
        }))
      : undefined;
  }
}
