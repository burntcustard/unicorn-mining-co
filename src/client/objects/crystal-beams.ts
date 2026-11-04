import type { Ship } from './ship';
import type { Pose } from '../types';
import type { ShipSpec } from '../../specs/ships/types';
import type { SimulationEvent } from '../protocol/events';
import { traceLaser } from './modules/trace-laser';
import { damage } from './damage';
import { Asteroid } from './asteroid';
import { outlineColorOf } from '../collision/types';
import { rotatePoint } from '../utilities/geometry';
import { renderBeamEffect } from '../effects/beam-effect';
import { laserBeam } from '../../specs/effects/laser-beam';
import { colors } from '../../specs/colors';
import { simulationStep } from '../../specs/simulation';
import * as Vec from '../utilities/vector';

/*
 * Trace all three rays before applying damage. An obstructed feeder cannot
 * strengthen the main ray during the same tick that it destroys its blocker.
 */
export const crystalBeams = (craft: Ship, pose: Pose = craft) => {
  const spec = craft.crystalWeapon as ShipSpec['crystalWeapon'];

  if (
    !spec ||
    !craft.world ||
    !craft.firing ||
    craft.dead ||
    craft.systemsPower <= 0 ||
    craft.dockedTo ||
    craft.launching
  ) {
    return [];
  }

  const junction = Vec.create(...spec.junction);

  const beams = spec.emitters.flatMap((emitter, index) => {
    if (
      !craft.segments.some(
        (segment) =>
          segment.hull &&
          segment.module === craft.hullSegments[emitter.hullIndex] &&
          !(segment.health < 1),
      )
    ) {
      return [];
    }

    const localStart = Vec.create(...emitter.position);
    const localEnd = index
      ? junction
      : Vec.add(localStart, Vec.create(spec.reach, 0));
    const start = Vec.add(
      pose.position,
      rotatePoint(localStart, pose.rotation),
    );
    const end = Vec.add(pose.position, rotatePoint(localEnd, pose.rotation));
    const trace = traceLaser({ craft, start, end });

    return [
      {
        ...trace,
        start,
        localStart,
        localEnd,
        index,
        fraction: index ? 0.25 : 0.5,
      },
    ];
  });

  const main = beams.find((beam) => !beam.index);

  if (main && main.length >= Vec.distance(main.localStart, junction)) {
    main.fraction +=
      beams.filter((beam) => beam.index && !beam.first).length * 0.25;
  }

  for (const beam of beams) beam.fraction *= craft.systemsPower;

  return beams;
};

export const resolveCrystalBeams = (
  craft: Ship,
  dt: number,
  events: SimulationEvent[],
) => {
  for (const beam of crystalBeams(craft)) {
    const first = beam.first;

    if (!first || first.physics === false) continue;
    const applied = damage(
      first.asteroidSegment || first.segment || first.owner,
      craft.crystalWeapon.damage * beam.fraction * 30 * dt,
    );

    if (!(applied > 0)) continue;
    const position = Vec.add(
      beam.start,
      Vec.scale(
        Vec.normalize(
          rotatePoint(
            Vec.subtract(beam.localEnd, beam.localStart),
            craft.rotation,
          ),
        ),
        beam.length,
      ),
    );

    events.push({
      type: 'laserDamage',
      targetId: first.owner.id,
      by: craft.playerId ?? 0,
      damage: applied,
      color: outlineColorOf(first),
      position,
    });

    if (first.owner instanceof Asteroid) {
      first.owner.fracture({
        asteroidSegment: first.asteroidSegment,
        by: craft.playerId ?? 0,
        events,
        world: craft.world,
      });
    }
  }
};

export const drawCrystalBeams = (
  craft: Ship,
  ctx: CanvasRenderingContext2D,
  pose: Pose,
) => {
  for (const beam of crystalBeams(craft, pose)) {
    const direction = Vec.subtract(beam.localEnd, beam.localStart);

    ctx.save();
    ctx.translate(beam.localStart.x, beam.localStart.y);
    ctx.rotate(Math.atan2(direction.y, direction.x));

    renderBeamEffect({
      ctx,
      effect: {
        ...laserBeam,
        layers: laserBeam.layers.map((layer) => ({
          ...layer,
          lineWidth: layer.lineWidth * Math.sqrt(beam.fraction),
        })),
      },
      color: colors.violet[2],
      barrelLength: 0,
      end: beam.length,
      hit: !!beam.first,
      elapsed: (craft.world.tick || 0) * simulationStep * 1000,
      draw: () => {},
    });

    ctx.restore();
  }
};
