import { type Vector } from '../vector';
import { type AsteroidSection } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { Asteroid } from './asteroid';
import { type Contact } from '../physics/collision/types';
import { Ship } from '../craft/ship';
import { type SimulationWorld } from './world';
import { type Segment } from '../types';
import { simulationStep } from './update-tier';

type MiningSurface = {
  asteroid: Asteroid;
  depth: number;
  position: Vector;
  section?: AsteroidSection;
  ship: Ship;
  segment: Segment;
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
    surfaces.push({
      asteroid,
      depth,
      position: drill.position,
      section: rock.part,
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
      const biteSteps = simulationStep * 60;
      const drillDamage = segment.module.damage * biteSteps;

      const pull = asteroid.position.subtract(ship.position).normalize();
      const grip = asteroid.velocity
        .subtract(ship.velocity)
        .scale(1 - 0.9 ** biteSteps)
        .add(pull.scale((1 - 0.9 ** biteSteps) / 0.1));

      ship.velocity.set(ship.velocity.add(grip));
      (section || asteroid).health -= drillDamage;
      events.push({
        asteroidId: asteroid.id,
        by: ship.playerId!,
        damage: drillDamage,
        resource: asteroid.resource,
        position,
        type: 'asteroidMined',
      });

      if (
        asteroid.fracture({
          section,
          by: ship.playerId!,
          events,
          world,
        })
      )
        ship.velocity.set(asteroid.velocity);
    });
};
