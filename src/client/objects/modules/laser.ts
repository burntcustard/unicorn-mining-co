import { Module, type ModuleRenderOptions } from './module';
import { Weapon } from './weapon';
import { game } from '../../game';
import { renderBeamEffect } from '../../effects/beam-effect';
import { simulationStep } from '../../../specs/simulation';
import * as Vec from '../../utilities/vector';
import { rotatePoint } from '../../utilities/geometry';
import { outlineColorOf } from '../../collision/types';
import { traceLaser } from './trace-laser';
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
        this.muzzlePosition({ distance: this.barrelLength }),
        pose.rotation,
      ),
    );
    const end = Vec.add(
      start,
      rotatePoint(Vec.create(this.reach, 0), pose.rotation + this.aimRotation),
    );

    return traceLaser({ craft, start, end });
  }

  resolveHits(craft: Ship, dt: number, events: SimulationEvent[]) {
    if (
      !craft.moduleFiring(this) ||
      !this.ready(craft) ||
      craft.playerId === undefined
    ) {
      return;
    }

    const { first, length } = this.trace(craft);

    if (!first || first.physics === false) return;
    const applied = damage(
      first.asteroidSegment || first.segment || first.owner,
      this.damage * 30 * dt,
    );

    if (applied <= 0) return;

    events.push({
      type: 'laserDamage',
      targetId: first.owner.id,
      by: craft.playerId,
      damage: applied,
      color: outlineColorOf(first),
      position: Vec.add(
        craft.position,
        rotatePoint(
          this.muzzlePosition({ distance: this.barrelLength + length }),
          craft.rotation,
        ),
      ),
    });

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
      craft.moduleFiring(this) &&
      this.ready(craft) &&
      craft.segmentsAtMount(this.mount).at(-1) === segment
    ) {
      const { first, length } = this.trace(craft, pose);

      game.ctx.save();
      game.ctx.rotate(this.aimRotation);

      renderBeamEffect({
        ctx: game.ctx,
        effect: this.beamEffect,
        color: this.shades[2],
        barrelLength: this.barrelLength,
        end: this.barrelLength + length,
        hit: !!first,
        elapsed: (craft.world.tick ?? 0) * simulationStep * 1000,
        draw: () => {
          game.ctx.save();
          game.ctx.rotate(-this.aimRotation);
          super.render(options);
          game.ctx.restore();
        },
      });

      game.ctx.restore();

      return;
    }

    super.render(options);
  }
}

export const Laser = LaserModule.define('laser');
export const LaserTurret = Laser.define('laserTurret');
