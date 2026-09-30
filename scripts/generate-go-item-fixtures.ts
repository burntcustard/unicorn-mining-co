import { writeFileSync } from 'node:fs';
import { itemTypes } from '../src/shared/items';
import { createWorld, addEntity } from '../src/shared/simulation/world';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { type SimulationEvent } from '../src/shared/protocol/events';
import * as Vec from '../src/shared/vector';

const record = (item: InstanceType<(typeof itemTypes)[number]>) => ({
  id: item.id,
  position: item.position,
  velocity: item.velocity,
  mass: item.mass,
  angularDrag: item.angularDrag,
  radius: item.radius,
  health: item.health,
  friction: item.friction,
  resource: item.resource,
  label: item.label ?? null,
  price: item.price ?? null,
  unlock: item.unlock ?? null,
  hitbox: item.hitbox().map((collider) => ({
    position: collider.position,
    radius: collider.radius,
    rotation: collider.rotation,
    physics: collider.physics,
    friction: collider.friction,
    bounciness: collider.bounciness ?? null,
    points: collider.shapeOutline ?? null,
    pickupPoint: collider.pickupPoint ?? false,
  })),
});
const samples = itemTypes.map((Type, resource) => {
  const properties = {
    id: resource + 100,
    position: Vec.create(-2, 9),
    velocity: Vec.create(1, 2),
    mass: 12,
    health: 0.5,
    angularDrag: 0.25,
    radius: 8,
  };

  return { resource, properties, result: record(new Type(properties)) };
});
const world = createWorld();
const asteroid = addEntity(
  world,
  createAsteroid(world, {
    id: 1,
    contents: [0, 1, 2, 3, 4],
    health: 0,
    position: Vec.create(4, 5),
    velocity: Vec.create(-2, 9),
  }),
);
const events: SimulationEvent[] = [];
const changed = asteroid.fracture({ by: 7, events, world });
const released = [...world.entities.values()].map((entity) =>
  record(entity as InstanceType<(typeof itemTypes)[number]>),
);

writeFileSync(
  'tests/go-fixtures/items.json',
  JSON.stringify({ samples, changed, events, released }),
);
