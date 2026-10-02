import { writeFileSync } from 'node:fs';
import * as Vec from '../src/shared/vector';
import { World } from '../src/shared/physics/world';
import { CircleShape } from '../src/shared/collision/shape/circle-shape';
import { PolygonShape } from '../src/shared/collision/shape/polygon-shape';
import '../src/shared/collision/shape/circle-circle-contact';
import '../src/shared/collision/shape/circle-polygon-contact';
import '../src/shared/collision/shape/polygon-polygon-contact';
import { simulationSpecification } from '../src/shared/specification/simulation';

const scenarios = [4, 8, 16].map((count) => {
  const world = new World();
  const bodies = Array.from({ length: count }, (_, index) => {
    const body = world.createBody();

    body.setMass(10 + index, 300 + index * 30);
    return body;
  });
  const makeShape = (index: number) =>
    index % 3 === 0
      ? new CircleShape(Vec.create(1, -1), 8)
      : new PolygonShape([
          Vec.create(-8, -6),
          Vec.create(8, -6),
          Vec.create(8, 6),
          Vec.create(-8, 6),
        ]);
  const fixtures = bodies.map((body, index) =>
    body.createFixture(makeShape(index), {
      userData: index + 1,
      physics: index % 7 !== 6,
    }),
  );
  const poses: object[] = [];
  let events: object[] = [];
  let tick = 0;

  world.onPreSolve((contact) => {
    contact.setFriction(0.2);
    contact.setRestitution(0.15);
    contact.setSurfaceSpeed(
      contact.getFixtureA().getUserData() === 2 ? 0.3 : 0,
    );
    const manifold = contact.getWorldManifold(null)!;

    events.push({
      a: contact.getFixtureA().getUserData(),
      b: contact.getFixtureB().getUserData(),
      type: contact.m_manifold.type,
      count: contact.m_manifold.pointCount,
      normal: Vec.clone(manifold.normal),
      points: manifold.points.map((point) => Vec.clone(point)),
      separations: [...manifold.separations],
    });
  });

  for (tick = 0; tick < (count === 4 ? 1200 : 300); tick++) {
    if (tick % 40 === 0) {
      bodies.forEach((body, index) => {
        if (body.m_destroyed) return;
        const angle = (index / count) * Math.PI * 2;
        const radius = tick % 80 === 0 ? 12 : 60;

        body.setTransform(
          Vec.create(Math.cos(angle) * radius, Math.sin(angle) * radius),
          angle * 0.1,
        );
        body.setLinearVelocity(
          Vec.create(-Math.cos(angle) * 180, -Math.sin(angle) * 180),
        );
        body.setAngularVelocity(index % 2 ? 0.2 : -0.3);
      });
    }

    if (tick === 75) {
      bodies[2].destroyFixture(fixtures[2]);
      fixtures[2] = bodies[2].createFixture(makeShape(2), { userData: 103 });
    }

    if (tick === 200) world.destroyBody(bodies[count - 1]);

    events = [];
    world.step(simulationSpecification.simulationStep, 8, 3);
    const contacts: number[][] = [];

    for (let c = world.m_contactList; c; c = c.m_next) {
      contacts.push([
        c.getFixtureA().getUserData() as number,
        c.getFixtureB().getUserData() as number,
      ]);
    }
    poses.push({
      bodies: bodies.map((body) => ({
        position: Vec.clone(body.getPosition()),
        rotation: body.getAngle(),
        velocity: Vec.clone(body.getLinearVelocity()),
        spin: body.getAngularVelocity(),
      })),
      contacts,
      events,
    });
  }
  return { count, poses };
});

writeFileSync(
  'tests/go-fixtures/physics-world.json',
  JSON.stringify(scenarios),
);
