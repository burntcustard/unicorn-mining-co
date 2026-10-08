import { Module, type ModuleRenderOptions } from './module';
import { Weapon } from './weapon';
import { game } from '../../game';
import { renderBeamEffect } from '../../effects/beam-effect';
import { simulationStep } from '../../../specs/simulation';
import * as Vec from '../../utilities/vector';
import { rotatePoint } from '../../utilities/geometry';
import { CircleShape } from '../../collision/shape/circle-shape';
import { PolygonShape } from '../../collision/shape/polygon-shape';
import { Sweep } from '../../physics/motion-sweep';
import { findTimeOfImpact } from '../../collision/time-of-impact';
import { type Collider } from '../../collision/types';
import { type Ship } from '../ship';
import { Asteroid } from '../asteroid';
import { damage } from '../damage';
import { type Pose } from '../../types';
import { type SimulationEvent } from '../../protocol/events';
import { type ModuleSpec } from '../../../specs/modules/types';

class LaserModule extends Module {
  static createModel(spec: Extract<ModuleSpec, { behavior: 'beam' }>) {
    return Weapon.createModel(spec);
  }

  ready(craft: Ship) {
    return (
      !!craft.world &&
      !craft.dead &&
      !craft.dockedTo &&
      !craft.launching &&
      this.mount?.health > 0 &&
      craft.segments.some(
        (segment) =>
          segment.module === this &&
          segment.active === 1 &&
          segment.activationProgress === 1,
      )
    );
  }

  trace(craft: Ship, pose: Pose = craft) {
    const start = Vec.add(
      pose.position,
      rotatePoint(
        Vec.add(this.mount.localPosition, Vec.create(this.barrelLength, 0)),
        pose.rotation,
      ),
    );
    const end = Vec.add(
      start,
      rotatePoint(Vec.create(this.reach, 0), pose.rotation),
    );
    let first: Collider | undefined;
    let fraction = 1;
    const shot = new CircleShape(Vec.create(), 0.5);
    const sweepA = new Sweep();
    const travel = this.reach;

    Vec.set(sweepA.c0, start);
    Vec.set(sweepA.c, end);

    for (const entity of craft.world.entities.values()) {
      if (
        entity === craft ||
        entity.dead ||
        entity.buried ||
        entity.kind === 'projectile' ||
        (craft.playerId !== undefined && entity.playerId === craft.playerId)
      ) {
        continue;
      }

      const reach = entity.radius + 0.5 + travel;

      if (Vec.distanceSquared(entity.position, end) > reach * reach) {
        continue;
      }

      for (const collider of entity.hitbox()) {
        if (
          (collider.physics === false &&
            !(entity.kind === 'station' && collider.segment?.hull)) ||
          collider.pickupPoint
        ) {
          continue;
        }

        const shape = collider.shapeOutline?.length
          ? new PolygonShape(
              collider.shapeOutline.map(([x, y]) => Vec.create(x, y)),
              collider.collisionMargin,
            )
          : new CircleShape(Vec.create(), collider.radius);
        const sweepB = new Sweep();

        Vec.set(sweepB.c, collider.position);
        Vec.set(sweepB.c0, collider.position);
        sweepB.a = collider.rotation;
        sweepB.a0 = collider.rotation;
        const result = { touching: false, t: fraction };

        findTimeOfImpact(result, {
          proxyA: shot,
          proxyB: shape,
          sweepA,
          sweepB,
          tMax: fraction,
        });

        if (
          (result.touching || result.t === 0) &&
          (!first || result.t < fraction)
        ) {
          first = collider;
          fraction = result.t;
        }
      }
    }

    return { first, length: this.reach * fraction };
  }

  resolveHits(craft: Ship, dt: number, events: SimulationEvent[]) {
    if (!craft.firing || !this.ready(craft) || craft.playerId === undefined) {
      return;
    }

    const { first } = this.trace(craft);

    if (!first || first.physics === false) return;
    damage(
      first.asteroidSegment || first.segment || first.owner,
      this.damage * this.damageStepsPerSecond * dt,
    );

    if (first.owner instanceof Asteroid) {
      first.owner.fracture({
        asteroidSegment: first.asteroidSegment,
        by: craft.playerId,
        events,
        world: craft.world,
      });
    }
  }

  render(options: ModuleRenderOptions) {
    const { segment, pose } = options;
    const craft = options.craft as Ship;

    if (
      craft &&
      craft.firing &&
      this.ready(craft) &&
      craft.segmentsAtMount(this.mount).at(-1) === segment
    ) {
      const { first, length } = this.trace(craft, pose);

      renderBeamEffect({
        ctx: game.ctx,
        effect: this.beamEffect,
        color: this.shades[2],
        barrelLength: this.barrelLength,
        end: this.barrelLength + length,
        hit: !!first,
        elapsed: (craft.world.tick ?? 0) * simulationStep * 1000,
        draw: () => super.render(options),
      });

      return;
    }

    super.render(options);
  }
}

export const Laser = LaserModule.define('laser');
