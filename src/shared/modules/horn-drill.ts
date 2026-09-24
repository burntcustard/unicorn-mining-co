import { colors } from '../colors';
import { Module } from './module';
import { type Vector } from '../vector';
import { type AsteroidSegment } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { type Segment } from '../types';
import { type Asteroid } from '../simulation/asteroid';
import { type Ship } from '../craft/ship';
import { type SimulationWorld } from '../simulation/world';

export class HornDrill extends Module {
  static shades = colors.yellow;
  static activationDuration = 0.5;
  static bounciness = (segment: any) =>
    segment.activationProgress > 0.5 ? -0.2 : 0;
  static damage = 0.5;
  static grinds = true;
  static health = 100;
  static model: any[] = [
    {
      points: [
        [3, -6],
        [27, 0],
        [3, 6],
      ],
    },
  ];
  static label = 'HORN DRILL';
  static price = 350;
  static zIndex = -1;

  mine({
    ship,
    segment,
    asteroid,
    asteroidSegment,
    position,
    events,
    world,
    dt,
  }: {
    ship: Ship;
    segment: Segment;
    asteroid: Asteroid;
    asteroidSegment?: AsteroidSegment;
    position: Vector;
    events: SimulationEvent[];
    world: SimulationWorld;
    dt: number;
  }) {
    if (
      segment.activationProgress <= 0.5 ||
      ship.playerId === undefined ||
      !world.entities.has(asteroid.id)
    ) {
      return;
    }
    segment.biting = true;
    const biteSteps = dt * 60;
    const drillDamage = this.damage * biteSteps;
    const pull = asteroid.position.subtract(ship.position).normalize();
    const grip = asteroid.velocity
      .subtract(ship.velocity)
      .scale(1 - 0.9 ** biteSteps)
      .add(pull.scale((1 - 0.9 ** biteSteps) / 0.1));

    ship.velocity.set(ship.velocity.add(grip));
    (asteroidSegment || asteroid).health -= drillDamage;
    events.push({
      asteroidId: asteroid.id,
      by: ship.playerId,
      damage: drillDamage,
      resource: asteroid.resource,
      position,
      type: 'asteroidMined',
    });

    if (
      asteroid.fracture({
        asteroidSegment,
        by: ship.playerId,
        events,
        world,
      })
    ) {
      ship.velocity.set(asteroid.velocity);
    }
  }
}
