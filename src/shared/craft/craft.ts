import * as Vec from '../vector';
import { type ModuleState } from './module-state';
import { type WreckageSegment } from './wreckage-segment';
import { cargoHatchOpen, moduleTypes } from '../modules';
import {
  movePoint,
  shapeOutlineExtent,
  rotatePoint,
  shapeOf,
} from '../geometry';
import { GameObject } from '../game-object';
import { colors, shadesOf } from '../colors';
import { applyForce } from '../physics/apply-force';
import { outerEdges } from '../polygon';
import { type Collider } from '../collision/types';
import { cargoContactAllowed } from '../modules/cargo-hatch';
import { Module } from '../modules/module';
import {
  type Mount,
  type ShapeOutline,
  type Shades,
  type Segment,
} from '../types';
import { entityId } from '../simulation/world';

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

const hullBounciness = 0.2;

// Default restitution when a segment supplies none.
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

  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one segment of it
  const duration =
    segmentPlan.activationDuration || craftModule.activationDuration || 0.1;

  // Hull health starts on the prototype; damage creates the instance's own
  // value. Module segments share their mount's health directly.
  return Object.assign(Object.create(segmentPlan), {
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
  }) as Segment;
};

export class Craft extends GameObject {
  static friction = 0.2;
  static hullSegments: HullSegmentPlan[] = [];
  static shades = colors.white;
  kind = 'craft';
  declare cargoContents: GameObject[];
  declare playerId?: number;
  health = 100;
  declare cockpit?: Segment;
  declare hullSegments: HullSegmentPlan[];
  declare mass: number;
  declare segments: Segment[];
  declare shades: Shades;

  constructor(props: CraftProperties = {}, data?: CraftData) {
    super(props);

    // Debris comes with its pieces already broken off something else. It is
    // worth about the same few seconds however big it was, give or take, so a
    // shipful of it does not all wink out at once
    if (this.segments) {
      this.cargoContents = props.cargoContents || [];
      this.hullSegments = props.hullSegments || [];
      this.decay = 1;
      this.health = 9 + this.random.next();
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

  launch() {
    this.dockedTo = undefined;
    this.launching = 3;
  }

  get moduleStates(): ModuleState[] {
    const mounts = this.mounts;

    return this.modules.map((module) => ({
      ...(!module.mount && { id: module.id }),
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

  get mounts() {
    return this.segments.flatMap((segment) => segment.mounts || []);
  }

  segmentsAtMount(mount: Mount) {
    return this.segments.filter((segment) => segment.mount === mount);
  }

  get modules(): Module[] {
    return [
      ...this.mounts.flatMap(({ module }) => (module ? [module] : [])),
      ...this.cargoContents.filter(
        (object): object is Module => object instanceof Module,
      ),
    ];
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

  hitbox() {
    if (this.dockedTo !== undefined && this.dockedTo !== 0) return [];

    const colliders = this.segments
      .filter(
        (segment) => segment.radius && !((segment.mount || segment).health < 1),
      )
      .flatMap((segment): Collider[] => {
        const { bounciness, friction } = segment.module;
        const points =
          typeof segment.points === 'function'
            ? segment.points(segment)
            : segment.points;
        const [middleX, middleY] = segment.middle || [0, 0];
        const position = Vec.add(
          this.position,
          rotatePoint(
            Vec.add(segment.localPosition, Vec.create(middleX, middleY)),
            this.rotation,
          ),
        );
        const shapeOutline =
          points &&
          (Object.assign(
            points.map(([x, y]) => [x - middleX, y - middleY]),
            { edges: points.edges },
          ) as ShapeOutline);

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

        const collider = Object.assign(
          (segment.collider ||= { owner: this, segment }),
          {
            bounciness:
              (bounciness?.call ? bounciness(segment) : bounciness) ??
              hullBounciness,
            friction:
              (friction?.call ? friction(segment) : friction) ?? this.friction,
            dockSegment: segment.dockSegment,
            role: segment.catches ? 'cargoHatch' : undefined,
            shapeOutline,
            collides: Boolean(collides),
            contactFilter: segment.catches ? cargoContactAllowed : undefined,
            physics,
            radius: segment.radius(segment),
            rotation: this.rotation,
            speed:
              segment.expandingTick !== undefined &&
              segment.expandingTick === this.world?.tick
                ? 60
                : 0,
            position,
          },
        );
        const drillTip = segment.module.drillTip;

        return drillTip
          ? [
              collider,
              {
                owner: this,
                segment,
                role: 'hornDrill',
                friction: this.friction,
                position: Vec.add(
                  this.position,
                  rotatePoint(
                    Vec.add(segment.localPosition, drillTip.position),
                    this.rotation,
                  ),
                ),
                radius: drillTip.radius,
                rotation: this.rotation,
                physics: false,
                collides: Boolean(collides),
              },
            ]
          : [collider];
      })
      .filter(({ radius }) => radius);
    const cover = colliders.find(
      ({ segment, radius }) => segment.covers && radius >= this.radius,
    );

    return cover ? [cover] : colliders;
  }

  momentum(position: Vec.Value) {
    const offset = Vec.subtract(position, this.position);

    return Vec.create(-offset.y * this.spin, offset.x * this.spin);
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

  get hullHealth() {
    return this.hullSegments.map((segmentPlan) =>
      segmentPlan.health === undefined
        ? -1
        : this.segments.find(
            (segment) => segment.hull && segment.module === segmentPlan,
          )?.health || 0,
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

  moduleActive({ module }: { module: typeof Module }) {
    return this.segments.some(
      (segment) =>
        segment.module instanceof module &&
        !((segment.mount || segment).health < 1) &&
        Boolean(segment.active),
    );
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

  toggle(craftModule: typeof Module) {
    this.segments.forEach((segment) => {
      if (segment.module instanceof craftModule) {
        segment.active = 1 - segment.active;
      }
    });
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
}
