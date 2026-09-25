import { World } from '../physics/world';
import { type Body } from '../physics/body';
import { type Fixture } from '../physics/fixture';
import { type Contact as PhysicsContact } from '../physics/contact';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import './shape/circle-circle-contact';
import './shape/polygon-polygon-contact';
import './shape/circle-polygon-contact';
import { type GameObject } from '../game-object';
import { Vector } from '../vector';
import { rotatePoint } from '../geometry';
import { type Collider, type Contact } from './types';
import { contactSpeedThreshold } from '../settings';
import { type SimulationEvent } from '../protocol/events';
import { damage } from '../craft/damage';
import { Asteroid } from '../simulation/asteroid';

type BodyRecord = {
  body: Body;
  entity: GameObject;
  fixtures: Fixture[];
  geometry: string;
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

export class GameCollisions {
  // Replays must not reuse bodies or contacts from an old timeline.
  private world = new World();
  private bodies = new Map<number, BodyRecord>();
  private contacts: Contact[] = [];
  private impacts = new Map<
    PhysicsContact,
    { contact: Contact; impact: number }
  >();

  constructor() {
    this.world.onPreSolve((contact) => {
      const a = contact.getFixtureA().getUserData() as Collider;
      const b = contact.getFixtureB().getUserData() as Collider;
      const manifold = contact.getWorldManifold(null);

      if (!manifold?.points.length) return;
      const point = manifold.points[0];
      const va = contact
        .getFixtureA()
        .getBody()
        .getLinearVelocityFromWorldPoint(point);
      const vb = contact
        .getFixtureB()
        .getBody()
        .getLinearVelocityFromWorldPoint(point);
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
        depth: Math.max(0, -Math.min(...manifold.separations)),
        normal: Vector(manifold.normal.x, manifold.normal.y),
        point: Vector(point.x, point.y),
      };

      this.contacts.push(found);

      if (physical && impact > (this.impacts.get(contact)?.impact || 0)) {
        this.impacts.set(contact, { contact: found, impact });
      }
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
    entities: GameObject[];
    previous: Map<number, { position: Vector; rotation: number }>;
    dt: number;
    events?: SimulationEvent[];
  }) {
    this.contacts = [];
    this.impacts.clear();
    const retained = new Set(entities.map((entity) => entity.id));

    this.bodies.forEach(({ body }, id) => {
      if (!retained.has(id)) {
        this.world.destroyBody(body);
        this.bodies.delete(id);
      }
    });

    const motions = entities.map((entity) => {
      const start = previous.get(entity.id) || {
        position: entity.position,
        rotation: entity.rotation,
      };
      const record = this.sync(entity);
      const velocity = dt
        ? entity.position.subtract(start.position).scale(1 / dt)
        : Vector();
      const spin = dt ? (entity.rotation - start.rotation) / dt : 0;

      record.body.setTransform(start.position, start.rotation);
      record.body.setLinearVelocity(velocity);
      record.body.setAngularVelocity(spin);
      return { record, start, velocity, spin };
    });

    this.world.step(dt, 8, 3);

    motions.forEach(({ record: { body, entity }, velocity, spin }) => {
      const position = body.getPosition();
      const resolved = body.getLinearVelocity();

      entity.position.set(position);
      entity.rotation = body.getAngle();

      entity.velocity.set(
        entity.velocity.add(Vector(resolved.x, resolved.y).subtract(velocity)),
      );
      entity.spin += body.getAngularVelocity() - spin;
    });

    this.impacts.forEach(({ contact: { collider, other, point }, impact }) => {
      const inverseMass = 1 / collider.owner.mass + 1 / other.owner.mass;
      const amount = Math.max(
        0,
        Math.round((impact / inverseMass - 400) / 1200),
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
        position: point,
      });
    });

    return this.contacts;
  }

  private sync(entity: GameObject) {
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
        geometry: '',
      };
      this.bodies.set(entity.id, record);
    }

    const colliders = entity
      .hitbox()
      .flatMap((collider: Collider & { colliders?: Collider[] }) =>
        collider.colliders?.length
          ? collider.colliders.map((nestedCollider) => ({
              ...collider,
              ...nestedCollider,
              bounciness: nestedCollider.bounciness ?? collider.bounciness,
              friction: nestedCollider.friction ?? collider.friction,
            }))
          : [collider],
      )
      .filter(
        ({ outline, collides }) =>
          collides !== false &&
          (!outline ||
            Math.abs(
              outline.reduce((area, [x, y], index) => {
                const next = outline[(index + 1) % outline.length];

                return area + x * next[1] - next[0] * y;
              }, 0),
            ) > 0.1),
      );

    const shapes = colliders.map((collider) => {
      const offset = rotatePoint(
        collider.position.subtract(entity.position),
        -entity.rotation,
      );

      return collider.outline
        ? collider.outline.map(([x, y]) =>
            offset.add(
              rotatePoint(Vector(x, y), collider.rotation - entity.rotation),
            ),
          )
        : {
            center: offset,
            radius: collider.radius,
          };
    });

    // Quantisation here only compares geometry, never simulation positions.
    const geometry = JSON.stringify(
      [
        entity.mass,
        entity.angularInertiaScale,
        shapes,
        colliders.map((c) => [
          c.physics !== false,
          c.collisionMargin,
          c.pickupPoint === true,
          c.role === 'cargoHatch',
        ]),
      ],
      (_, value) =>
        typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value,
    );

    if (geometry !== record.geometry) {
      record.fixtures.forEach((fixture) =>
        record!.body.destroyFixture(fixture),
      );
      record.fixtures = shapes.map((shape, index) => {
        const collider = colliders[index];
        const fixtureShape = Array.isArray(shape)
          ? new PolygonShape(shape, collider.collisionMargin)
          : new CircleShape(shape.center, shape.radius);

        return record!.body.createFixture(fixtureShape, {
          physics: colliders[index].physics !== false,
          userData: colliders[index],
        });
      });
      record.geometry = geometry;

      record.body.setMass(
        entity.mass,
        entity.mass *
          entity.angularInertiaScale *
          inertiaPerMass(record.fixtures),
      );
    } else {
      record.fixtures.forEach((fixture, index) =>
        fixture.setUserData(colliders[index]),
      );
    }

    return record;
  }
}
