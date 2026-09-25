import * as Vec from '../vector';
import { colors } from '../colors';
import { Module } from './module';
import { type Collider } from '../collision/types';
import { damage } from '../craft/damage';
import { type SimulationEvent } from '../protocol/events';
import { type Segment } from '../types';
import { Asteroid } from '../simulation/asteroid';
import { type Ship } from '../craft/ship';
import { type SimulationWorld } from '../simulation/world';

export class HornDrill extends Module {
  static shades = colors.yellow;
  static activationDuration = 0.5;
  static bounciness = (segment: any) =>
    segment.activationProgress > 0.5 ? -0.4 : undefined;
  static friction = 0.3;
  static damage = 0.5;
  static grinds = true;
  static drillTip = { position: Vec.create(26, 0), radius: 3 };
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

  drill({
    ship,
    segment,
    target,
    position,
    events,
    world,
    dt,
  }: {
    ship: Ship;
    segment: Segment;
    target: Collider;
    position: Vec.Value;
    events: SimulationEvent[];
    world: SimulationWorld;
    dt: number;
  }) {
    const targetPart = target.segment || target.asteroidSegment || target.owner;
    const healthTarget = target.segment?.mount || targetPart;
    const before = healthTarget.health;

    if (
      segment.activationProgress <= 0.5 ||
      ship.playerId === undefined ||
      !world.entities.has(target.owner.id) ||
      !(before > 0)
    ) {
      return;
    }
    const drillSteps = dt * 60;
    const drillDamage = this.damage * drillSteps;

    damage(targetPart, drillDamage);

    if (!(healthTarget.health < before)) return;
    segment.biting = true;
    const asteroid =
      target.owner instanceof Asteroid ? target.owner : undefined;

    if (asteroid) {
      const pull = Vec.normalize(
        Vec.subtract(asteroid.position, ship.position),
      );
      const gripFactor = 1 - 0.9 ** drillSteps;
      const grip = Vec.add(
        Vec.scale(Vec.subtract(asteroid.velocity, ship.velocity), gripFactor),
        Vec.scale(pull, gripFactor / 0.1),
      );

      Vec.set(ship.velocity, Vec.add(ship.velocity, grip));
    }
    events.push({
      targetId: target.owner.id,
      by: ship.playerId,
      damage: drillDamage,
      ...(asteroid && { resource: asteroid.resource }),
      position,
      type: 'drillDamage',
    });

    if (
      asteroid?.fracture({
        asteroidSegment: target.asteroidSegment,
        by: ship.playerId,
        events,
        world,
      })
    ) {
      Vec.set(ship.velocity, asteroid.velocity);
    }
  }
}
