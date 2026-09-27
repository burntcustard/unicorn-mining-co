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
import { contactSpeedThreshold } from '../settings';
import { type SimulationEvent } from '../protocol/events';
import { damage } from '../craft/damage';
import { Craft } from '../craft/craft';
import { Asteroid } from '../simulation/asteroid';
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
  private retained = new Set<number>();
  private motions: BodyRecord[] = [];
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
  capturePoses(entities: Iterable<GameObject>) {
    for (const entity of entities) {
      const { previous } = this.recordFor(entity);

      Vec.set(previous.position, entity.position);
      previous.rotation = entity.rotation;
    }
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
    entities: GameObject[];
    previous?: Map<number, Pose>;
    dt: number;
    events?: SimulationEvent[];
  }) {
    this.contacts = [];
    this.impacts.clear();
    const retained = this.retained;

    retained.clear();
    entities.forEach((entity) => retained.add(entity.id));

    this.bodies.forEach(({ body }, id) => {
      if (!retained.has(id)) {
        this.world.destroyBody(body);
        this.bodies.delete(id);
      }
    });

    const motions = this.motions;

    motions.length = 0;
    entities.forEach((entity) => {
      const record = this.sync(entity);
      const start =
        (previous ? previous.get(entity.id) : record.previous) || entity;
      const velocity = record.velocity;

      if (dt) {
        Vec.subtract(entity.position, start.position, velocity);
        Vec.scale(velocity, 1 / dt, velocity);
      } else Vec.setXY(velocity, 0, 0);
      record.spin = dt ? (entity.rotation - start.rotation) / dt : 0;

      record.body.setTransform(start.position, start.rotation);
      record.body.setLinearVelocity(velocity);
      record.body.setAngularVelocity(record.spin);
      motions.push(record);
    });

    this.world.step(dt, 8, 3);

    motions.forEach(({ body, entity, velocity, spin }) => {
      const position = body.getPosition();
      const resolved = body.getLinearVelocity();

      Vec.set(entity.position, position);
      entity.rotation = body.getAngle();

      entity.velocity.x += resolved.x - velocity.x;
      entity.velocity.y += resolved.y - velocity.y;
      entity.spin += body.getAngularVelocity() - spin;
    });

    this.impacts.forEach(({ contact: { collider, other, point }, impact }) => {
      const inverseMass = 1 / collider.owner.mass + 1 / other.owner.mass;
      // Keep the first-damage threshold near 1000 while making harder hits
      // climb roughly twice as fast.
      const amount = Math.max(
        0,
        Math.round((impact / inverseMass - 700) / 600),
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
      };
      this.bodies.set(entity.id, record);
    }

    return record;
  }

  private sync(entity: GameObject) {
    const record = this.recordFor(entity);

    let geometrySource: object | undefined =
      entity instanceof Asteroid && entity.hitbox === Asteroid.prototype.hitbox
        ? entity.geometrySource
        : undefined;

    if (
      geometrySource &&
      geometrySource === record.geometrySource &&
      same(entity.mass, record.geometry[0]) &&
      same(entity.angularInertiaScale, record.geometry[1])
    ) {
      return record;
    }
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

    record.fixtures.forEach((fixture) => record!.body.destroyFixture(fixture));
    cursor = 2;

    record.fixtures = colliders.map((collider) => {
      cursor += 2;
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
    record.body.setProxyRadius(
      Math.max(
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
      ),
    );

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
