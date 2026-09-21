import { Vector } from '../vector';
import { type AsteroidSection } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { Asteroid } from './asteroid';
import { createItem } from '../items/create-item';
import { type Contact } from './physics';
import { Ship } from '../craft/ship';
import { addEntity, type SimulationWorld } from './world';
import { type Segment } from '../types';

type MiningSurface = {
  asteroid: Asteroid;
  depth: number;
  position: Vector;
  section?: AsteroidSection;
  ship: Ship;
  segment: Segment;
};

const destroy = ({
  asteroid,
  by,
  events,
  world,
}: {
  asteroid: Asteroid;
  by: number;
  events: SimulationEvent[];
  world: SimulationWorld;
}) => {
  asteroid.remove();
  asteroid.contents.forEach((resource) =>
    addEntity(
      world,
      createItem(world, {
        position: asteroid.position.add(Vector()),
        resource,
        velocity: asteroid.velocity.add(Vector()),
      }),
    ),
  );
  events.push({
    asteroidId: asteroid.id,
    by,
    contents: asteroid.contents,
    type: 'asteroidDestroyed',
  });
};

/** Apply one mining bite to the exact asteroid section touched by each drill. */
export const mine = ({
  contacts,
  events,
  world,
}: {
  contacts: Contact[];
  events: SimulationEvent[];
  world: SimulationWorld;
}) => {
  const surfaces: MiningSurface[] = [];

  contacts.forEach(({ collider, depth, other }) => {
    const drill = collider.role === 'drill' ? collider : other;
    const rock = drill === collider ? other : collider;
    const ship = drill.owner;
    const asteroid = rock.owner;

    if (
      drill.role !== 'drill' ||
      !(ship instanceof Ship) ||
      !drill.segment ||
      drill.segment.activationProgress <= 0.5 ||
      !drill.segment.module.grinds ||
      ship.playerId === undefined ||
      !(asteroid instanceof Asteroid) ||
      asteroid.dead
    )
      return;
    const section = asteroid.sections?.includes(rock.part as AsteroidSection)
      ? (rock.part as AsteroidSection)
      : undefined;

    surfaces.push({
      asteroid,
      depth,
      position: drill.position,
      section,
      ship,
      segment: drill.segment,
    });
  });

  const drills = new Set<Segment>();

  surfaces
    .sort((a, b) => b.depth - a.depth)
    .forEach(({ asteroid, position, section, ship, segment }) => {
      if (drills.has(segment) || !world.entities.has(asteroid.id)) return;
      drills.add(segment);
      segment.biting = true;
      const drillDamage = segment.module.damage;

      const pull = asteroid.position.subtract(ship.position).normalize();
      const grip = asteroid.velocity
        .subtract(ship.velocity)
        .scale(0.1)
        .add(pull);

      ship.velocity.set(ship.velocity.add(grip));
      if (section) section.health -= drillDamage;
      else asteroid.health -= drillDamage;
      events.push({
        asteroidId: asteroid.id,
        by: ship.playerId!,
        damage: drillDamage,
        resource: asteroid.resource,
        position,
        type: 'asteroidMined',
      });

      if (section && section.health < 1) {
        ship.velocity.set(asteroid.velocity);
        const children = asteroid.detach({ section, world });
        events.push({
          type: 'asteroidSplit',
          asteroidId: asteroid.id,
          childIds: children.map((child) => child.id),
        });
      } else if (asteroid.health < 1) {
        ship.velocity.set(asteroid.velocity);
        destroy({ asteroid, by: ship.playerId!, events, world });
      }
    });
};
