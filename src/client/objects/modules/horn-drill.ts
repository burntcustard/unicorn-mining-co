import * as Vec from '../../utilities/vector';
import { moduleDefinitions } from '../../../definitions/modules/index';
import { Module } from './module';
import { outlineColorOf, type Collider } from '../../collision/types';
import { damage } from '../damage';
import { type SimulationEvent } from '../../protocol/events';
import { type Segment } from '../../types';
import { Asteroid } from '../../simulation/asteroid';
import { type Ship } from '../ship';
import { type SimulationWorld } from '../../simulation/world';

const specification = moduleDefinitions.hornDrill;

export class HornDrill extends Module {
  static shades = specification.shades;
  static activationDuration = specification.activationDuration;
  static bounciness = (segment: any) =>
    segment.activationProgress > specification.activationThreshold
      ? -0.4
      : undefined;
  static friction = specification.friction;
  static damage = specification.damage;
  static grinds = specification.grinds;
  static drillTip = {
    position: Vec.create(
      specification.drillTip.position.x,
      specification.drillTip.position.y,
    ),
    radius: specification.drillTip.radius,
  };
  static health = specification.health;
  static model: any[] = [{ points: specification.points }];
  static label = specification.label;
  static price = specification.price;
  static zIndex = specification.zIndex;

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
      segment.activationProgress <= specification.activationThreshold ||
      ship.playerId === undefined ||
      !world.entities.has(target.owner.id) ||
      !(before > 0)
    ) {
      return;
    }
    const drillSteps = dt * specification.damageStepsPerSecond;
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
      const gripFactor = 1 - specification.gripDecay ** drillSteps;
      const grip = Vec.add(
        Vec.scale(Vec.subtract(asteroid.velocity, ship.velocity), gripFactor),
        Vec.scale(pull, gripFactor / specification.gripScale),
      );

      Vec.set(ship.velocity, Vec.add(ship.velocity, grip));
    }
    events.push({
      targetId: target.owner.id,
      by: ship.playerId,
      damage: drillDamage,
      color: outlineColorOf(target),
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
