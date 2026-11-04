import type { Ship } from '../ship';
import type { Collider } from '../../collision/types';
import * as Vec from '../../utilities/vector';
import { CircleShape } from '../../collision/shape/circle-shape';
import { PolygonShape } from '../../collision/shape/polygon-shape';
import { Sweep } from '../../physics/motion-sweep';
import { findTimeOfImpact } from '../../collision/time-of-impact';

/*
 * Trace one finite laser against the same physical surfaces as fitted lasers.
 */
export const traceLaser = ({
  craft,
  start,
  end,
}: {
  craft: Ship;
  start: Vec.Value;
  end: Vec.Value;
}) => {
  let first: Collider | undefined;
  let fraction = 1;
  const shot = new CircleShape(Vec.create(), 0.5);
  const sweepA = new Sweep();
  const travel = Vec.distance(start, end);

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

  return { first, length: travel * fraction };
};
