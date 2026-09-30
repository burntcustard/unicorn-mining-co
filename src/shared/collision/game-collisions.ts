import * as Vec from '../vector';
import { rotatePoint } from '../geometry';
import { World } from '../physics/world';
import { WorldManifold } from './contact-manifold';
import { type Body } from '../physics/body';
import { type Fixture } from '../physics/fixture';
import { type Contact as PhysicsContact } from '../physics/contact';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import './shape/circle-circle-contact';
import './shape/polygon-polygon-contact';
import './shape/circle-polygon-contact';
import { type GameObject } from '../game-object';
import { outlineColorOf, type Collider, type Contact } from './types';
import { contactSpeedThreshold, linearSlop } from '../settings';
import { simulationSpecification } from '../specification/simulation';
import { type SimulationEvent } from '../protocol/events';
import { damage } from '../craft/damage';
import { Craft } from '../craft/craft';
import { Asteroid } from '../simulation/asteroid';
import { Station } from '../craft/station';
import { type Pose } from '../types';

type BodyRecord = {
  body: Body;
  entity: GameObject;
  fixtures: Fixture[];
  geometry: number[];
  roundedGeometry: number[];
  geometrySource?: object;
  velocity: Vec.Value;
  spin: number;
  previous: Pose;
  sweepStart: Pose;
  // Farthest fixture extent from the body origin.
  radius: number;
  // Locked asteroid geometry measured without fixtures until first needed.
  deferred?: Asteroid;
  // Geometry sync postponed while parked.
  syncPending?: boolean;
  // Whether the entity is in the ballistic set.
  ballistic?: boolean;
};

// Match the solver's per-step motion limits for bodies integrated here.
const { maxTranslation, maxRotation } = simulationSpecification.physics;
// Wake bodies before contact, like the broad-phase's fattened bounds.
const { wakeMargin } = simulationSpecification.physics;
// Objects that touched nothing in their last collision step move freely.
const ballisticEntities = new WeakSet<GameObject>();

export const isBallistic = (entity: GameObject) =>
  ballisticEntities.has(entity);

// The record's flag mirrors set membership, so the set changes only on
// transitions rather than for every object every step.
const markBallistic = (record: BodyRecord) => {
  if (record.ballistic) return;
  record.ballistic = true;
  ballisticEntities.add(record.entity);
};

// Explicit object mass controls translation. Geometry only determines how
// strongly an off-centre hit rotates it around the object's origin.
const inertiaPerMass = (fixtures: Fixture[]) => {
  let area = 0;
  let moment = 0;

  fixtures.forEach(({ m_physics, m_shape }) => {
    if (!m_physics) return;

    if (m_shape instanceof CircleShape) {
      const radiusSquared = m_shape.m_radius ** 2;
      const circleArea = Math.PI * radiusSquared;
      const { x, y } = m_shape.m_p;

      area += circleArea;
      moment += circleArea * (radiusSquared / 2 + x * x + y * y);
    } else if (m_shape instanceof PolygonShape) {
      const vertices = m_shape.m_vertices;

      vertices.forEach(({ x, y }, index) => {
        const next = vertices[(index + 1) % vertices.length];
        const cross = x * next.y - next.x * y;

        area += cross / 2;
        moment +=
          (cross *
            (x * x +
              x * next.x +
              next.x * next.x +
              y * y +
              y * next.y +
              next.y * next.y)) /
          12;
      });
    }
  });

  return area > 0 ? moment / area : 0;
};

const same = (a: number, b: number) =>
  a === b || Math.round(a * 1e6) === Math.round(b * 1e6);

// Four fixture flags fit below the polygon vertex count.
const geometryFlags = (collider: Collider) =>
  ((collider.shapeOutline?.length || 0) << 4) |
  +(collider.physics !== false) |
  (+(collider.collisionMargin !== undefined) << 1) |
  (+(collider.pickupPoint === true) << 2) |
  (+(collider.role === 'cargoHatch') << 3);

export class GameCollisions {
  // Replays must not reuse bodies or contacts from an old timeline.
  private world = new World();
  private manifold = new WorldManifold();
  private velocityA = Vec.create();
  private velocityB = Vec.create();
  private bodies = new Map<number, BodyRecord>();
  private contacts: Contact[] = [];
  private motions: BodyRecord[] = [];
  private found: (BodyRecord | undefined)[] = [];
  private bounds = new Float64Array(0);
  private sortOrder: number[] = [];
  private free = new Uint8Array(0);
  private impacts = new Map<
    PhysicsContact,
    { contact: Contact; impact: number }
  >();

  constructor() {
    this.world.onPreSolve((contact) => {
      const a = contact.getFixtureA().getUserData() as Collider;
      const b = contact.getFixtureB().getUserData() as Collider;
      const manifold = contact.getWorldManifold(this.manifold);

      if (!manifold?.points.length) return;
      const point = manifold.points[0];
      const va = contact
        .getFixtureA()
        .getBody()
        .getLinearVelocityFromWorldPoint(point, this.velocityA);
      const vb = contact
        .getFixtureB()
        .getBody()
        .getLinearVelocityFromWorldPoint(point, this.velocityB);
      const physical = a.physics !== false && b.physics !== false;
      const surfaceSpeed = physical ? (a.speed || 0) + (b.speed || 0) : 0;
      const impact = physical
        ? surfaceSpeed -
          ((vb.x - va.x) * manifold.normal.x +
            (vb.y - va.y) * manifold.normal.y)
        : 0;

      if (physical) {
        contact.setSurfaceSpeed(surfaceSpeed);
        // The geometric mean lets either surface drive friction to zero.
        contact.setFriction(Math.sqrt(a.friction * b.friction));
        // Average both contributions, retaining damping and exaggerated bounce
        // before the final nonnegative clamp. Slow contacts do not bounce.
        contact.setRestitution(
          impact < contactSpeedThreshold
            ? 0
            : Math.max(0, ((a.bounciness ?? 0) + (b.bounciness ?? 0)) / 2),
        );
      }

      const found: Contact = {
        collider: a,
        other: b,
        depth: Math.max(
          0,
          -manifold.separations[0],
          manifold.pointCount > 1 ? -manifold.separations[1] : 0,
        ),
        normal: Vec.clone(manifold.normal),
        point: Vec.clone(point),
      };

      this.contacts.push(found);

      if (physical && impact > (this.impacts.get(contact)?.impact || 0)) {
        this.impacts.set(contact, { contact: found, impact });
      }
    });
  }

  /*
   * Capture starting poses beside their bodies before gameplay advances them.
   */
  capturePoses(entities: ReadonlyMap<number, GameObject>) {
    entities.forEach((entity) => {
      const { previous } = this.recordFor(entity);

      Vec.set(previous.position, entity.position);
      previous.rotation = entity.rotation;
    });
  }

  /*
   * Gameplay still calculates steering, thrust, drag and its intended endpoint.
   * The solver sweeps that motion, replacing only the displacement/velocity
   * caused by contacts. It does not apply a second damping or thrust model.
   */
  step({
    entities,
    previous,
    dt,
    events = [],
  }: {
    entities: ReadonlyMap<number, GameObject>;
    previous?: Map<number, Pose>;
    dt: number;
    events?: SimulationEvent[];
  }) {
    this.contacts = [];
    this.impacts.clear();

    // Hitboxes can change membership while syncing, so visit a fresh snapshot.
    const visiting = [...entities.values()];
    const found = this.found;
    let live = 0;

    found.length = 0;

    for (let index = 0; index < visiting.length; index++) {
      const record = this.bodies.get(visiting[index].id);

      found.push(record);

      if (record?.entity === visiting[index]) live++;
    }

    // Records are keyed by ID, so any beyond the live ones may have left.
    if (live !== this.bodies.size) {
      this.bodies.forEach(({ body }, id) => {
        if (!entities.has(id)) {
          this.world.destroyBody(body);
          this.bodies.delete(id);
        }
      });
    }

    const motions = this.motions;

    motions.length = 0;

    for (let index = 0; index < visiting.length; index++) {
      const entity = visiting[index];
      let record = found[index];

      // Parked rocks and stations with locked geometry cannot grow, so their
      // last bound holds until something wakes them.
      if (
        record?.entity === entity &&
        record.body.m_parked &&
        record.geometrySource &&
        (entity instanceof Asteroid || entity instanceof Station)
      ) {
        record.syncPending = true;
      } else record = this.sync(entity);
      const start =
        (previous ? previous.get(entity.id) : record.previous) || entity;
      const velocity = record.velocity;

      if (dt) {
        Vec.subtract(entity.position, start.position, velocity);
        Vec.scale(velocity, 1 / dt, velocity);
      } else Vec.setXY(velocity, 0, 0);
      record.spin = dt ? (entity.rotation - start.rotation) / dt : 0;
      record.sweepStart = start;
      motions.push(record);
    }
    const free = this.findFree(motions);

    for (let index = 0; index < motions.length; index++) {
      const record = motions[index];
      const { body, entity, sweepStart: start } = record;

      if (free[index] && !body.m_contactList) {
        if (!body.m_parked) body.park();
        markBallistic(record);
        continue;
      }

      if (record.syncPending) {
        record.syncPending = false;
        this.sync(entity);
      }

      if (record.deferred) {
        this.syncDetailed(record.deferred, record, record.geometrySource);
        record.deferred = undefined;
      }
      body.setTransform(start.position, start.rotation);
      body.setLinearVelocity(record.velocity);
      body.setAngularVelocity(record.spin);

      if (body.m_parked) body.unpark();
    }

    this.world.step(
      dt,
      simulationSpecification.physics.velocityIterations,
      simulationSpecification.physics.positionIterations,
    );

    for (let index = 0; index < motions.length; index++) {
      const record = motions[index];

      if (!record.body.m_parked) markBallistic(record);
    }
    this.contacts.forEach(({ collider, other }) => {
      this.touched(collider.owner);
      this.touched(other.owner);
    });

    for (let index = 0; index < motions.length; index++) {
      const {
        body,
        entity,
        velocity,
        spin,
        sweepStart: start,
      } = motions[index];

      if (body.m_parked) {
        // An isolated island: the solver's integration without its setup.
        // Bodies report angles in [-pi, pi], as the sweep's atan2 would.
        let angle = start.rotation;

        if (angle > Math.PI) angle -= 2 * Math.PI;
        else if (angle < -Math.PI) angle += 2 * Math.PI;

        if (!(Math.abs(angle) <= Math.PI)) {
          angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        }

        if (dt > 0) {
          let vx = velocity.x;
          let vy = velocity.y;
          let w = spin;
          const tx = vx * dt;
          const ty = vy * dt;
          const translation = tx * tx + ty * ty;

          if (translation > maxTranslation * maxTranslation) {
            const ratio = maxTranslation / Math.sqrt(translation);

            vx *= ratio;
            vy *= ratio;
          }
          const rotation = dt * w;

          if (rotation * rotation > maxRotation * maxRotation) {
            w *= maxRotation / Math.abs(rotation);
          }
          Vec.setXY(
            entity.position,
            start.position.x + vx * dt,
            start.position.y + vy * dt,
          );
          angle += dt * w;
          entity.velocity.x += vx - velocity.x;
          entity.velocity.y += vy - velocity.y;
          entity.spin += w - spin;
        } else Vec.set(entity.position, start.position);
        entity.rotation = angle;
        continue;
      }
      const position = body.getPosition();
      const resolved = body.getLinearVelocity();

      Vec.set(entity.position, position);
      entity.rotation = body.getAngle();

      entity.velocity.x += resolved.x - velocity.x;
      entity.velocity.y += resolved.y - velocity.y;
      entity.spin += body.getAngularVelocity() - spin;
    }

    this.impacts.forEach(({ contact: { collider, other, point }, impact }) => {
      const inverseMass = 1 / collider.owner.mass + 1 / other.owner.mass;
      // Keep the first-damage threshold near 1000 while making harder hits
      // climb roughly twice as fast.
      const { damageBase, damageScale } = simulationSpecification.physics;
      const amount = Math.max(
        0,
        Math.round((impact / inverseMass - damageBase) / damageScale),
      );

      if (amount) {
        for (const [hit, struckBy] of [
          [collider, other],
          [other, collider],
        ]) {
          if (hit.owner.dead) continue;
          damage(hit.segment || hit.asteroidSegment || hit.owner, amount);

          if (hit.owner instanceof Asteroid && hit.owner.world) {
            hit.owner.fracture({
              asteroidSegment: hit.asteroidSegment,
              by: struckBy.owner.playerId ?? 0,
              events,
              world: hit.owner.world,
            });
          }
        }
      }

      events.push({
        type: 'collision',
        a: collider.owner.id,
        b: other.owner.id,
        impact,
        colors: [outlineColorOf(collider), outlineColorOf(other)],
        position: point,
      });
    });

    return this.contacts;
  }

  /*
   * Sweep and prune bounding circles around each body's whole swept motion.
   * A body whose circle meets no other cannot touch anything this step.
   */
  private findFree(motions: BodyRecord[]) {
    const count = motions.length;

    if (this.free.length < count) {
      this.free = new Uint8Array(count * 2);
      this.bounds = new Float64Array(count * 8);
    }
    const { bounds, free, sortOrder: order } = this;
    // Reuse last step's order when the population is unchanged: it is
    // nearly sorted, so insertion sort finishes in about one pass.
    const reuse = order.length === count;

    if (!reuse) order.length = count;

    for (let index = 0; index < count; index++) {
      const { entity, radius, sweepStart: start } = motions[index];
      const dx = entity.position.x - start.position.x;
      const dy = entity.position.y - start.position.y;
      const travel = Math.sqrt(dx * dx + dy * dy);
      const reach = radius + travel + wakeMargin;
      const x = start.position.x + dx / 2;

      bounds[index * 4] = x - reach;
      bounds[index * 4 + 1] = x;
      bounds[index * 4 + 2] = start.position.y + dy / 2;
      bounds[index * 4 + 3] = reach;
      free[index] = 1;

      if (!reuse) order[index] = index;
    }

    if (reuse) {
      for (let i = 1; i < count; i++) {
        const item = order[i];
        const key = bounds[item * 4];
        let j = i - 1;

        while (j >= 0 && bounds[order[j] * 4] > key) {
          order[j + 1] = order[j];
          j--;
        }
        order[j + 1] = item;
      }
    } else order.sort((a, b) => bounds[a * 4] - bounds[b * 4]);

    for (let i = 0; i < count; i++) {
      const a = order[i] * 4;
      const right = bounds[a + 1] + bounds[a + 3];

      for (let j = i + 1; j < count; j++) {
        const b = order[j] * 4;

        if (bounds[b] > right) break;
        const dx = bounds[a + 1] - bounds[b + 1];
        const dy = bounds[a + 2] - bounds[b + 2];
        const reach = bounds[a + 3] + bounds[b + 3];

        if (dx * dx + dy * dy <= reach * reach) {
          free[order[i]] = free[order[j]] = 0;
        }
      }
    }
    return free;
  }

  private touched(owner: GameObject) {
    const record = this.bodies.get(owner.id);

    if (record?.entity === owner) record.ballistic = false;
    ballisticEntities.delete(owner);
  }

  private recordFor(entity: GameObject) {
    let record = this.bodies.get(entity.id);

    if (record && record.entity !== entity) {
      this.world.destroyBody(record.body);
      this.bodies.delete(entity.id);
      record = undefined;
    }

    if (!record) {
      record = {
        entity,
        body: this.world.createBody(),
        fixtures: [],
        geometry: [],
        roundedGeometry: [],
        velocity: Vec.create(),
        spin: 0,
        previous: {
          position: Vec.clone(entity.position),
          rotation: entity.rotation,
        },
        sweepStart: entity,
        radius: 0,
      };
      this.bodies.set(entity.id, record);
    }

    return record;
  }

  private sync(entity: GameObject) {
    const record = this.recordFor(entity);

    // Check cached asteroid geometry before constructing its built-in hitbox.
    if (
      entity instanceof Asteroid &&
      entity.hitbox === Asteroid.prototype.hitbox
    ) {
      const geometrySource = entity.geometrySource;

      if (
        geometrySource &&
        geometrySource === record.geometrySource &&
        (record.deferred ||
          (same(entity.mass, record.geometry[0]) &&
            same(entity.angularInertiaScale, record.geometry[1])))
      ) {
        return record;
      }

      // Most asteroids never meet anything: measure them, build on contact.
      if (geometrySource && !record.fixtures.length) {
        record.radius = entity.extent + 2 * linearSlop;
        record.geometrySource = geometrySource;
        record.deferred = entity;
        return record;
      }
      record.deferred = undefined;
      return this.syncDetailed(entity, record, geometrySource);
    }
    return this.syncDetailed(entity, record);
  }

  private syncDetailed(
    entity: GameObject,
    record: BodyRecord,
    geometrySource?: object,
  ) {
    const hitbox =
      entity instanceof Craft ? entity.hitbox(true) : entity.hitbox();

    if (entity instanceof Craft && entity.hitbox === Craft.prototype.hitbox) {
      geometrySource = entity.geometrySource;

      if (
        geometrySource &&
        geometrySource === record.geometrySource &&
        same(entity.mass, record.geometry[0]) &&
        same(entity.angularInertiaScale, record.geometry[1])
      ) {
        return record;
      }
    }

    const colliders = hitbox.filter(
      ({ shapeOutline, collides }) =>
        collides !== false &&
        (!shapeOutline ||
          Math.abs(
            shapeOutline.reduce((area, [x, y], index) => {
              const next = shapeOutline[(index + 1) % shapeOutline.length];

              return area + x * next[1] - next[0] * y;
            }, 0),
          ) > 0.1),
    );

    let cursor = 2;
    const previous = record.geometry;
    // Keep the original values for exact matches and cache their quantization.
    // Only the incoming geometry needs rounding on subsequent comparisons.
    const rounded = record.roundedGeometry;
    const matches = (value: number, index: number) =>
      value === previous[index] || Math.round(value * 1e6) === rounded[index];
    const inverseSin = Math.sin(-entity.rotation);
    const inverseCos = Math.cos(-entity.rotation);
    const unchanged =
      matches(entity.mass, 0) &&
      matches(entity.angularInertiaScale, 1) &&
      colliders.every((collider) => {
        const dx = collider.position.x - entity.position.x;
        const dy = collider.position.y - entity.position.y;
        const x = dx * inverseCos - dy * inverseSin;
        const y = dx * inverseSin + dy * inverseCos;
        const angle = collider.rotation - entity.rotation;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const start = cursor;
        const outline = collider.shapeOutline;

        cursor += 2 + (outline ? outline.length * 2 : 3);
        return (
          previous[start] === geometryFlags(collider) &&
          matches(collider.collisionMargin ?? 0, start + 1) &&
          (outline
            ? outline.every(
                (point, index) =>
                  matches(
                    x + (point[0] * cos - point[1] * sin),
                    start + 2 + index * 2,
                  ) &&
                  matches(
                    y + (point[0] * sin + point[1] * cos),
                    start + 3 + index * 2,
                  ),
              )
            : matches(x, start + 2) &&
              matches(y, start + 3) &&
              matches(collider.radius, start + 4))
        );
      });

    if (unchanged && cursor === previous.length) {
      record.fixtures.forEach((fixture, index) =>
        fixture.setUserData(colliders[index]),
      );
      record.geometrySource =
        hitbox.length === record.fixtures.length ? geometrySource : undefined;
      return record;
    }

    const geometry = [entity.mass, entity.angularInertiaScale];

    colliders.forEach((collider) => {
      const offset = rotatePoint(
        Vec.subtract(collider.position, entity.position),
        -entity.rotation,
      );
      const angle = collider.rotation - entity.rotation;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      geometry.push(geometryFlags(collider), collider.collisionMargin ?? 0);

      if (collider.shapeOutline) {
        collider.shapeOutline.forEach(([x, y]) =>
          geometry.push(
            offset.x + (x * cos - y * sin),
            offset.y + (x * sin + y * cos),
          ),
        );
      } else geometry.push(offset.x, offset.y, collider.radius);
    });

    // Keep fixtures whose own slice of geometry is unchanged, such as a hull
    // beside an animating module, and replace only the others.
    const slices = (values: number[]) => {
      const starts: number[] = [];

      for (let at = 2; at < values.length;) {
        starts.push(at);
        at += 2 + ((values[at] >> 4) * 2 || 3);
      }
      return starts;
    };
    const oldStarts =
      previous.length > 2 && matches(geometry[0], 0) && matches(geometry[1], 1)
        ? slices(previous)
        : ([] as number[]);
    const newStarts = slices(geometry);
    const kept = colliders.map((_, index) => {
      const fixture = record.fixtures[index];
      const from = oldStarts[index];
      const to = newStarts[index];
      const length = (newStarts[index + 1] ?? geometry.length) - to;

      if (
        !fixture ||
        oldStarts.length !== record.fixtures.length ||
        (oldStarts[index + 1] ?? previous.length) - from !== length
      ) {
        return undefined;
      }

      for (let offset = 0; offset < length; offset++) {
        if (!matches(geometry[to + offset], from + offset)) return undefined;
      }
      return fixture;
    });

    record.fixtures.forEach((fixture, index) => {
      if (kept[index] !== fixture) record.body.destroyFixture(fixture);
    });

    record.fixtures = colliders.map((collider, index) => {
      const fixture = kept[index];

      if (fixture) {
        fixture.setUserData(collider);
        return fixture;
      }
      cursor = newStarts[index] + 2;
      const point = () => Vec.create(geometry[cursor++], geometry[cursor++]);
      const shape = collider.shapeOutline
        ? new PolygonShape(
            collider.shapeOutline.map(point),
            collider.collisionMargin,
          )
        : new CircleShape(point(), geometry[cursor++]);

      return record!.body.createFixture(shape, {
        physics: collider.physics !== false,
        userData: collider,
      });
    });
    record.geometry = geometry;
    record.roundedGeometry = geometry.map((value) => Math.round(value * 1e6));
    record.radius = Math.max(
      0,
      ...record.fixtures.map(
        ({ m_shape }) =>
          m_shape.m_radius +
          (m_shape instanceof PolygonShape
            ? Math.max(
                ...m_shape.m_vertices.map((vertex) => Vec.length(vertex)),
              )
            : Vec.length((m_shape as CircleShape).m_p)),
      ),
    );
    record.body.setProxyRadius(record.radius);

    record.body.setMass(
      entity.mass,
      entity.mass *
        entity.angularInertiaScale *
        inertiaPerMass(record.fixtures),
    );

    record.geometrySource =
      hitbox.length === record.fixtures.length ? geometrySource : undefined;
    return record;
  }
}
