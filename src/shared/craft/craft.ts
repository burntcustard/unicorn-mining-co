import { type ModuleState } from './module-state';
import { type WreckagePart } from './wreckage-part';
import { scoopOpen, moduleTypes } from '../modules';
import { movePoint, rotatePoint, shapeOf } from '../geometry';
import { GameObject } from '../game-object';
import { colors, paletteOf } from '../colors';
import { Vector, type Vector as VectorValue } from '../vector';
import { applyForce } from '../simulation/apply-force';
import { outerEdges } from '../collision/outer-edges';
import { collisionCategories } from '../collision/types';
import { Module } from '../modules/module';
import { type Mount, type Outline, type Palette, type Segment } from '../types';
import { entityId } from '../simulation/world';

type ModuleRecord = Module;
type HullPart = Partial<Segment> & {
  [key: string]: any;
  health?: number;
  mounts?: Mount[];
  points?: Outline | ((segment: Segment) => Outline);
};
type CraftData = {
  [key: string]: any;
  hullSegments: HullPart[];
};
type CraftProperties = {
  [key: string]: any;
  cargoContents?: GameObject[];
  position?: VectorValue;
  segments?: Segment[];
  velocity?: VectorValue;
};

const hullBounciness = 0.1;

// Default restitution when a segment supplies none.
import { approach } from '../utilities/approach';

const centerOf = (segments: Segment[]) =>
  segments
    .reduce((center, { middle }) => center.add(Vector(...middle!)), Vector())
    .scale(1 / segments.length);
const outlinesOf = (segments: Segment[]) =>
  segments
    .map(({ points }) => points)
    .filter((points): points is Outline => Array.isArray(points));

const makeSegment = (
  craft: Craft,
  craftModule: ModuleRecord | HullPart,
  part: HullPart,
  mount?: Mount,
): Segment => {
  const { points } = part;
  const fixedPoints = Array.isArray(points) ? points : undefined;
  const shape = fixedPoints?.[0] && shapeOf(fixedPoints, mount);

  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one part of it
  const duration =
    part.activationDuration || craftModule.activationDuration || 0.1;

  // Hull health starts on the prototype; damage creates the instance's own
  // value. Module parts share their mount's health directly.
  return Object.assign(Object.create(part), {
    phase: 0,
    ...shape,
    activationProgress: 0,
    hull: !mount,
    module: craftModule,
    mount,
    active: 0,
    radius: part.radius || (shape && (() => shape.reach)),
    rate: 1 / duration,
    shades: craftModule.shades || craft.shades,
    localPosition: (mount?.localPosition || part.localPosition || Vector()).add(
      Vector(0, (part.thrusterNozzleSide || 0) * (craftModule.offset || 0)),
    ),
    zIndex: part.zIndex || craftModule.zIndex || craft.zIndex || 0,
  }) as Segment;
};

export class Craft extends GameObject {
  static hullSegments: HullPart[] = [];
  static shades = colors.white;
  kind: string = 'craft';
  declare cargoContents: GameObject[];
  declare playerId?: number;
  health = 100;
  declare cockpit?: Segment;
  declare hullSegments: HullPart[];
  declare mass: number;
  declare segments: Segment[];
  declare shades: Palette;

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

  get moduleStates(): ModuleState[] {
    const mounts = this.mounts;

    return this.modules.map((module) => ({
      ...(!module.mount && { id: module.id }),
      type: moduleTypes.findIndex((Type) => module instanceof Type),
      mount: mounts.indexOf(module.mount),
      health: module.mount ? module.mount.health : module.health,
      shades: module.shades,
      parts: this.partsOf(module.mount)
        .filter((part) => part.module === module)
        .map((part) => ({
          active: part.active,
          activationProgress: part.activationProgress,
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

      if (state.shades) module.shades = paletteOf(state.shades);

      if (state.mount >= 0) {
        const mount = mounts[state.mount];

        if (mount) {
          if (!unchanged) this.fit(module, mount);
          mount.health = state.health;
          this.partsOf(mount).forEach((part, index) =>
            Object.assign(part, state.parts[index], {
              shades: module.shades || this.shades,
            }),
          );
        }
      } else if (!unchanged) this.cargoContents.push(module);
    });
  }

  get wreckage(): WreckagePart[] | undefined {
    return this.decay
      ? this.segments.map((segment) => ({
          outline:
            typeof segment.points === 'function'
              ? segment.points(segment)
              : segment.points,
          radius: segment.radius?.(segment) || 0,
          offset: segment.localPosition,
          health: (segment.mount || segment).health,
          fillShade: segment.fillShade,
          stroke: segment.outline,
        }))
      : undefined;
  }

  get mounts() {
    return this.segments.flatMap((segment) => segment.mounts || []);
  }

  partsOf(mount: Mount) {
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
  // instances stay in the inventory and become cargo when their link clears.
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
        ...craftModule.model!.map((part) =>
          makeSegment(this, craftModule, part as HullPart, mount),
        ),
      );
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

        rebuilt.mounts = (part.mounts || []).map((mount) => ({
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
    origin: VectorValue,
    segments: Segment[],
    own: Partial<Segment>,
    away = origin,
  ) {
    const position = this.position.add(rotatePoint(origin, this.rotation));
    const velocity = this.velocity.add(this.momentum(position));
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
          hitbox: 0,
          localPosition:
            own.localPosition || segment.localPosition.subtract(origin),
        }),
      ),
      spin: this.spin,
      position,
    });

    applyForce(
      fragment,
      rotatePoint(away, this.rotation).normalize().scale(30),
      this.random.next() - 0.5,
    );

    fragment.add();
    return fragment;
  }

  // A broken module keeps its shape long enough to tumble away as debris,
  // while the original mount is immediately free again for the dock menu.
  detach(mount: Mount) {
    const mountedSegments = this.partsOf(mount);
    const debrisSegments = mountedSegments.filter(
      (segment) => segment.debris !== false,
    );
    let debrisMiddle: VectorValue | undefined;
    const segments = debrisSegments.map((segment) => {
      const debris = segment.debris;
      const points =
        typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points;
      const middle = points?.length
        ? points
            .reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
            .map((sum) => sum / points.length)
        : [0, 0];
      const radius = points
        ? Math.max(
            ...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])),
          )
        : 0;

      if (debris && typeof debris === 'object') {
        if (debrisSegments.length === 1) {
          debrisMiddle = Vector(middle[0], middle[1]);
        }
        return Object.assign(Object.create(segment), debris, {
          points: points?.map(([x, y]) => [x - middle[0], y - middle[1]]),
          fillShade:
            (segment.mount || segment).health < segment.module.health / 2
              ? 0
              : 1,
          radius: () => radius,
        });
      }
      return segment;
    });
    const origin = mount.localPosition.add(debrisMiddle || Vector());

    // Destroyed instances leave the inventory rather than becoming cargo.
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
        ...(debrisMiddle && { localPosition: Vector() }),
      },
      origin,
    );
  }

  hitboxes() {
    if (this.dockedTo !== undefined && this.dockedTo !== 0) return [];

    const boxes = this.segments
      .filter(
        (segment) => segment.radius && !((segment.mount || segment).health < 1),
      )
      .map((segment) => {
        const { bounciness } = segment.module;
        const points =
          typeof segment.points === 'function'
            ? segment.points(segment)
            : segment.points;
        const [middleX, middleY] = segment.middle || [0, 0];
        const position = this.position.add(
          rotatePoint(
            segment.localPosition.add(Vector(middleX, middleY)),
            this.rotation,
          ),
        );
        const outline =
          points &&
          (Object.assign(
            points.map(([x, y]) => [x - middleX, y - middleY]),
            { edges: points.edges },
          ) as Outline);

        const physics =
          this.physics &&
          !segment.module.disablePhysics &&
          !segment.catches &&
          !(
            segment.module.scoops &&
            !segment.active &&
            !segment.activationProgress
          ) &&
          !segment.mounts?.some(
            (mount) =>
              mount.module &&
              mount.module.scoops &&
              this.partsOf(mount).some(
                (part) =>
                  !((part.mount || part).health < 1) &&
                  part.activationProgress > scoopOpen,
              ),
          );
        const collides =
          physics ||
          segment.dockSegment ||
          (segment.catches &&
            segment.active &&
            segment.activationProgress > scoopOpen);

        return Object.assign((segment.hitbox ||= { owner: this, segment }), {
          bounciness:
            (bounciness?.call ? bounciness(segment) : bounciness) ||
            hullBounciness,
          dockSegment: segment.dockSegment,
          role: segment.catches
            ? 'scoop'
            : segment.module.grinds
              ? 'drill'
              : undefined,
          outline,
          collides: Boolean(collides),
          collisionCategory: segment.catches
            ? collisionCategories.scoopMouth
            : collisionCategories.solid,
          collisionMask: segment.catches
            ? collisionCategories.pickupPoint
            : collisionCategories.solid,
          physics,
          radius: segment.radius(segment),
          rotation: this.rotation,
          speed:
            segment.covers && segment.active > segment.activationProgress && 60,
          position,
        });
      })
      .filter(({ radius }) => radius);
    const cover = boxes.find(
      ({ segment, radius }) => segment.covers && radius >= this.radius,
    );

    return cover ? [cover] : boxes;
  }

  momentum(position: VectorValue) {
    const offset = position.subtract(this.position);

    return Vector(-offset.y * this.spin, offset.x * this.spin);
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
          middle.subtract(center),
        );
      });

    // Broken pieces are made into temporary wreckage before the intact hull
    // is fractured, so do not let this pass alter the parent ship.
    if (wreckage) return fragments;
    const kept = (core || []).map((i) => hulls[i]);

    if (core && fragments.length) {
      const away = rotatePoint(centerOf(kept).subtract(center), this.rotation);

      applyForce(this, away.normalize().scale(30), this.random.next() - 0.5);
    }

    this.segments = this.segments.filter(
      (segment) => kept.includes(segment) || kept.includes(segment.mount?.hull),
    );

    if (kept.length) {
      outerEdges(outlinesOf(kept));
    } else {
      this.cargoContents.splice(0).forEach((item) => {
        item.world = this.world;
        item.position.set(this.position);
        item.velocity.set(this.velocity);

        if (item.mass > 0) {
          applyForce(
            item,
            movePoint(Vector(), this.random.next() * Math.PI * 2, 30),
            this.random.next() - 0.5,
          );
        }
        item.add();
      });
      this.remove();
    }

    return fragments;
  }

  get hullHealth() {
    return this.hullSegments.map((part) =>
      part.health === undefined
        ? -1
        : this.segments.find(
            (segment) => segment.hull && segment.module === part,
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
    this.hullSegments.forEach((part, index) => {
      const segment = this.segments.find(
        (segment) => segment.hull && segment.module === part,
      );

      if (segment && part.health !== undefined) segment.health = values[index];
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

      segment.activationProgress = approach(
        segment.activationProgress,
        target,
        segment.rate * dt,
      );
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
        this.position.set(station.position);
        this.rotation = station.rotation;
      }
      this.velocity.set(Vector());
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
