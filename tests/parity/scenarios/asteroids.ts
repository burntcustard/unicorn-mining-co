import * as Vec from '../../../src/client/utilities/vector';
import { createWorld, addEntity } from '../../../src/client/simulation/world';
import {
  Asteroid,
  createAsteroid,
  shapeOutlineOf,
  shapeOutlinesFrom,
  asteroidContact,
} from '../../../src/client/simulation/asteroid';
import { type SimulationEvent } from '../../../src/client/protocol/events';

const record = (asteroid: Asteroid) =>
  structuredClone({
    id: asteroid.id,
    position: asteroid.position,
    velocity: asteroid.velocity,
    rotation: asteroid.rotation,
    spin: asteroid.spin,
    radius: asteroid.radius,
    mass: asteroid.mass,
    health: asteroid.health,
    maxHealth: asteroid.maxHealth,
    decay: asteroid.decay || 0,
    contents: asteroid.contents,
    damaged: asteroid.damaged,
    extent: asteroid.extent,
    outline: shapeOutlineOf(asteroid),
    segments: asteroid.segments || [],
    boundaries: asteroid.segments ? shapeOutlinesFrom(asteroid.segments) : [],
    hitbox: asteroid.hitbox().map((collider) => ({
      position: collider.position,
      rotation: collider.rotation,
      radius: collider.radius,
      friction: collider.friction,
      outline: collider.shapeOutline,
    })),
  });
const samples = [1, 25, 9128, 4294967295].flatMap((id) =>
  [25, 57, 150].map((radius, index) => {
    const world = createWorld();
    const properties = {
      id,
      radius,
      ...(index === 1 ? { radiusEven: 9, pointCount: 10 } : {}),
      contents: [0, 1, 2, 3, 1, 0],
      position: Vec.create(-32.375, 79.25),
      velocity: Vec.create(2.125, -3.5),
      rotation: 0.7125,
      spin: -0.125,
    };
    const asteroid = addEntity(
      world,
      createAsteroid(world, properties).lockGeometry(),
    );
    const initial = record(asteroid);
    const contacts = [
      Vec.create(),
      Vec.create(radius, 0),
      Vec.create(0, radius),
      Vec.create(radius * 2, radius),
    ].map((offset) => {
      const position = Vec.add(asteroid.position, offset);

      return {
        position,
        radius: 3,
        contact: asteroidContact({ asteroid, position, radius: 3 }) || null,
      };
    });
    const steps = [];

    for (let step = 0; step < 12; step++) {
      const target = [...world.entities.values()].find(
        (entity): entity is Asteroid =>
          entity instanceof Asteroid && !!entity.segments?.length,
      );

      if (!target) break;
      const segmentIndex = (step * 7) % target.segments!.length;
      const segment = target.segments![segmentIndex];

      segment.health = 0;
      const events: SimulationEvent[] = [];
      const changed = target.fracture({
        asteroidSegment: segment,
        by: 1,
        events,
        world,
      });

      steps.push({
        id: target.id,
        segmentIndex,
        changed,
        events,
        entities: [...world.entities.values()].map((entity) =>
          record(entity as Asteroid),
        ),
      });
    }
    return { properties, initial, contacts, steps };
  }),
);

export default samples;
