import { World } from '../dynamics/physics-world';
import { type Body } from '../dynamics/physics-body';
import { type Fixture } from '../dynamics/collision-fixture';
import { type Contact as PhysicsContact } from '../dynamics/collision-contact';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import './shape/circle-circle-contact';
import './shape/polygon-polygon-contact';
import './shape/circle-polygon-contact';
import { Vec2 } from '../common/physics-vector';
import {
  physicsScale,
  contactSpeedThreshold,
} from '../common/game-physics-settings';
import { type GameObject } from '../game-object';
import { Vector } from '../vector';
import { rotatePoint } from '../geometry';
import { collisionCategories, type Collider, type Contact } from './types';
import { type SimulationEvent } from '../protocol/events';
import { damage } from '../craft/damage';
import { Asteroid } from '../simulation/asteroid';

type BodyRecord = {
  body: Body;
  entity: GameObject;
  fixtures: Fixture[];
  geometry: string;
};

export class GameCollisions {
  private world = new World({
    gravity: Vec2.zero(),
    // Replays must not depend on impulses cached by the abandoned timeline.
    warmStarting: false,
    allowSleep: false,
  });
  private bodies = new Map<number, BodyRecord>();
  private contacts: Contact[] = [];
  private impacts = new Map<
    PhysicsContact,
    { contact: Contact; impact: number }
  >();

  constructor() {
    this.world.on('pre-solve', (contact) => {
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
      const impact = physical
        ? -Vec2.dot(Vec2.sub(vb, va), manifold.normal) / physicsScale
        : 0;

      if (physical) {
        contact.setRestitution(
          impact < contactSpeedThreshold
            ? 0
            : Math.max(0, (a.bounciness || 0) + (b.bounciness || 0)),
        );
      }
      const found: Contact = {
        collider: a,
        other: b,
        depth: Math.max(0, -Math.min(...manifold.separations)) / physicsScale,
        normal: Vector(manifold.normal.x, manifold.normal.y),
        point: Vector(point.x / physicsScale, point.y / physicsScale),
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

      record.body.setTransform(
        start.position.scale(physicsScale),
        start.rotation,
      );
      record.body.setLinearVelocity(velocity.scale(physicsScale));
      record.body.setAngularVelocity(spin);
      return { record, start, velocity, spin };
    });

    this.world.step(dt, 8, 3);
    motions.forEach(({ record: { body, entity }, velocity, spin }) => {
      const position = body.getPosition();
      const resolved = body.getLinearVelocity();

      entity.position.set(
        Vector(position.x / physicsScale, position.y / physicsScale),
      );
      entity.rotation = body.getAngle();

      if (entity.mass) {
        entity.velocity.set(
          entity.velocity.add(
            Vector(
              resolved.x / physicsScale,
              resolved.y / physicsScale,
            ).subtract(velocity),
          ),
        );
        entity.spin += body.getAngularVelocity() - spin;
      }
    });
    this.impacts.forEach(({ contact: { collider, other, point }, impact }) => {
      const inverseMass =
        (collider.owner.mass ? 1 / collider.owner.mass : 0) +
        (other.owner.mass ? 1 / other.owner.mass : 0);
      const amount = inverseMass
        ? Math.max(0, Math.round((impact / inverseMass - 400) / 1200))
        : 0;

      if (amount) {
        for (const [hit, struckBy] of [
          [collider, other],
          [other, collider],
        ]) {
          if (hit.owner.dead) continue;
          damage(hit.segment || hit.part || hit.owner, amount);

          if (hit.owner instanceof Asteroid && hit.owner.world) {
            hit.owner.fracture({
              section: hit.part,
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
        body: this.world.createBody({
          type: entity.mass ? 'dynamic' : 'kinematic',
          bullet: true,
        }),
        fixtures: [],
        geometry: '',
      };
      this.bodies.set(entity.id, record);
    }
    const colliders = entity
      .hitboxes()
      .flatMap((collider: Collider & { parts?: Collider[] }) =>
        collider.parts?.length
          ? collider.parts.map((part) => ({
              ...collider,
              ...part,
              bounciness: collider.bounciness,
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
            offset
              .add(
                rotatePoint(Vector(x, y), collider.rotation - entity.rotation),
              )
              .scale(physicsScale),
          )
        : {
            center: offset.scale(physicsScale),
            radius: collider.radius * physicsScale,
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
          c.collisionCategory ?? collisionCategories.solid,
          c.collisionMask ?? collisionCategories.solid,
        ]),
      ],
      (_, value) =>
        typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value,
    );

    if (geometry !== record.geometry) {
      record.fixtures.forEach((fixture) =>
        record!.body.destroyFixture(fixture),
      );
      record.fixtures = shapes.map((shape, index) => {
        const collider = colliders[index];
        const fixtureShape = Array.isArray(shape)
          ? new PolygonShape(shape)
          : new CircleShape(shape.center, shape.radius);

        if (Array.isArray(shape) && collider.collisionMargin !== undefined) {
          fixtureShape.m_radius = collider.collisionMargin * physicsScale;
        }
        return record!.body.createFixture(fixtureShape, {
          density: colliders[index].physics === false ? 0 : 1,
          friction: 0,
          physics: colliders[index].physics !== false,
          filterCategoryBits:
            colliders[index].collisionCategory ?? collisionCategories.solid,
          filterMaskBits:
            colliders[index].collisionMask ?? collisionCategories.solid,
          userData: colliders[index],
        });
      });
      record.geometry = geometry;

      if (entity.mass) {
        const mass = record.body.getMass();

        record.body.setMassData({
          mass: entity.mass,
          center: Vec2.zero(),
          I: mass
            ? (record.body.getInertia() *
                entity.mass *
                entity.angularInertiaScale) /
              mass
            : 0,
        });
      }
    } else {
      record.fixtures.forEach((fixture, index) =>
        fixture.setUserData(colliders[index]),
      );
    }
    return record;
  }
}
