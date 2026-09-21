import { type AsteroidEntity, type ShipEntity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { Vector } from '../../vector';
import { addEntity } from './world';
import { Asteroid, asteroidContact, nearestSection } from './asteroid';
import { createItem } from './item';
import { type SimulationWorld } from './world';

const drillReach = 24;
const drillDamage = 0.5;

export const mine = (
  world: SimulationWorld,
  ship: ShipEntity,
  events: SimulationEvent[],
) => {
  if (!ship.drill || ship.playerId === undefined) return;

  let target: AsteroidEntity | undefined;
  let nearest = Infinity;

  [...world.entities.values()].forEach((entity) => {
    if (entity.kind !== 'asteroid' || entity.decay) return;

    const offset = entity.position.subtract(ship.position);
    const distance = offset.length();
    const along = offset.dot(
      Vector(Math.cos(ship.rotation), Math.sin(ship.rotation)),
    );

    if (
      along >= 0 &&
      distance < nearest &&
      distance <= ship.radius + drillReach + entity.radius &&
      asteroidContact({
        asteroid: entity,
        position: ship.position,
        radius: ship.radius + drillReach,
      })
    ) {
      nearest = distance;
      target = entity;
    }
  });

  if (!target) return;

  const section = nearestSection({ asteroid: target, position: ship.position });

  if (section) section.health -= drillDamage;
  else target.health -= drillDamage;
  events.push({
    asteroidId: target.id,
    by: ship.playerId,
    damage: drillDamage,
    type: 'asteroidMined',
  });

  if (section && section.health < 1) {
    if (target instanceof Asteroid) target.detach({ section, world });
    return;
  }

  if (target.health < 1) {
    world.entities.delete(target.id);
    target.contents.forEach((resource) =>
      addEntity(
        world,
        createItem(world, {
          position: target.position.add(Vector()),
          resource,
          velocity: target.velocity.add(
            Vector(world.random.next() * 2 - 1, world.random.next() * 2 - 1),
          ),
        }),
      ),
    );
    events.push({
      asteroidId: target.id,
      by: ship.playerId,
      contents: target.contents,
      type: 'asteroidDestroyed',
    });
  }
};
