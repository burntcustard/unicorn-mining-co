import { game } from '../../game';
import { linesPath, shapePath } from '../../utilities/drawing';
import * as Vec from '../../utilities/vector';
import { type ModuleSpec } from '../../../specs/modules/types';
import { Module, type ModuleRenderOptions } from './module';
import { outlineColorOf, type Collider } from '../../collision/types';
import { damage } from '../damage';
import { type SimulationEvent } from '../../protocol/events';
import { type Segment } from '../../types';
import { Asteroid } from '../asteroid';
import { type Ship } from '../ship';
import { type SimulationWorld } from '../../simulation/world';

class HornDrillModule extends Module {
  static bounciness = (segment: Segment) =>
    segment.activationProgress > segment.module.activationThreshold
      ? -0.4
      : undefined;

  static createModel(spec: Extract<ModuleSpec, { behavior: 'hornDrill' }>) {
    return [{ points: spec.points }];
  }

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
      segment.activationProgress <= this.activationThreshold ||
      ship.playerId === undefined ||
      !world.entities.has(target.owner.id) ||
      !(before > 0)
    ) {
      return;
    }

    const drillSteps = dt * this.damageStepsPerSecond;
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
      const gripFactor = 1 - this.gripDecay ** drillSteps;
      const grip = Vec.add(
        Vec.scale(Vec.subtract(asteroid.velocity, ship.velocity), gripFactor),
        Vec.scale(pull, gripFactor / this.gripScale),
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

  render({ segment }: ModuleRenderOptions) {
    super.render({ segment });
    const { ctx } = game;

    ctx.save();
    ctx.strokeStyle = (this.shades || segment.shades)[2];
    ctx.clip(
      shapePath(
        typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points,
      ),
    );

    ctx.stroke(
      linesPath(
        Array.from({ length: 6 }, (_, index) => {
          const middle = 3 + (index - 1 + (segment.phase || 0)) * 6;

          return [
            [middle - 3, -6],
            [middle + 3, 6],
          ];
        }),
      ),
    );

    ctx.restore();
  }

  updateVisual({ dt, segments }: { dt: number; segments: Segment[] }) {
    segments.forEach((segment) => {
      segment.phase =
        ((segment.phase || 0) + dt * 1.5 * segment.activationProgress) % 1;
    });
  }
}

export const HornDrill = HornDrillModule.define('hornDrill');

export type HornDrill = InstanceType<typeof HornDrill>;
