import { Manifold } from './Manifold';
import { CircleShape } from './shape/CircleShape';
import { PolygonShape } from './shape/PolygonShape';
import { CollideCircles } from './shape/CollideCircle';
import { CollidePolygons } from './shape/CollidePolygon';
import { CollidePolygonCircle } from './shape/CollideCirclePolygon';
import { Transform } from '../common/Transform';
import { Vector } from '../../vector';
import { type Collider } from './types';
import { physicsScale } from '../game-settings';

type ShapeData = Partial<Collider> & {
  position: Vector;
  radius: number;
  parts?: ShapeData[];
};

/*
 * Read-only overlap query using the same narrow phase as the dynamics solver.
 * Contact skin is included: resting bodies need not geometrically penetrate.
 */
export const hit = (a: ShapeData, b: ShapeData) => {
  let deepest:
    | {
        depth: number;
        normal: Vector;
        point: Vector;
        aPart?: ShapeData;
        bPart?: ShapeData;
      }
    | undefined;
  (a.parts || [a]).forEach((pa) =>
    (b.parts || [b]).forEach((pb) => {
      const shape = (part: ShapeData) => {
        const result = part.outline
          ? new PolygonShape(
              part.outline.map(([x, y]) => Vector(x, y).scale(physicsScale)),
            )
          : new CircleShape(part.radius * physicsScale);
        if (part.outline && part.collisionMargin !== undefined)
          result.m_radius = part.collisionMargin * physicsScale;
        return result;
      };
      const sa = shape(pa),
        sb = shape(pb);
      const xa = new Transform(a.position.scale(physicsScale), a.rotation || 0);
      const xb = new Transform(b.position.scale(physicsScale), b.rotation || 0);
      const manifold = new Manifold();
      let reversed = false;
      if (sa instanceof PolygonShape && sb instanceof PolygonShape)
        CollidePolygons(manifold, sa, xa, sb, xb);
      else if (sa instanceof PolygonShape && sb instanceof CircleShape)
        CollidePolygonCircle(manifold, sa, xa, sb, xb);
      else if (sa instanceof CircleShape && sb instanceof PolygonShape) {
        CollidePolygonCircle(manifold, sb, xb, sa, xa);
        reversed = true;
      } else
        CollideCircles(manifold, sa as CircleShape, xa, sb as CircleShape, xb);
      if (!manifold.pointCount) return;
      const contact = reversed
        ? manifold.getWorldManifold(null, xb, sb.m_radius, xa, sa.m_radius)
        : manifold.getWorldManifold(null, xa, sa.m_radius, xb, sb.m_radius);
      const depth = -Math.min(...contact.separations) / physicsScale;
      if (deepest && deepest.depth >= depth) return;
      deepest = {
        depth,
        normal: Vector(contact.normal.x, contact.normal.y).scale(
          reversed ? -1 : 1,
        ),
        point: Vector(contact.points[0].x, contact.points[0].y).scale(
          1 / physicsScale,
        ),
        aPart: a.parts ? pa : undefined,
        bPart: b.parts ? pb : undefined,
      };
    }),
  );
  return deepest;
};
