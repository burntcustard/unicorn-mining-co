import { Manifold } from './contact-manifold';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import { CollideCircles } from './shape/circle-circle-contact';
import { CollidePolygons } from './shape/polygon-polygon-contact';
import { CollidePolygonCircle } from './shape/circle-polygon-contact';
import { Transform } from '../common/physics-transform';
import { Vector } from '../vector';
import { type Collider } from './types';
import { physicsScale } from '../common/game-physics-settings';

type ShapeData = Partial<Collider> & {
  position: Vector;
  radius: number;
  colliders?: ShapeData[];
};

/*
 * Read-only overlap query using the same narrow phase as the dynamics solver.
 * Contact skin is included: resting bodies need not geometrically penetrate.
 */
export const contactBetween = (a: ShapeData, b: ShapeData) => {
  let deepest:
    | {
        depth: number;
        normal: Vector;
        point: Vector;
        aCollider?: ShapeData;
        bCollider?: ShapeData;
      }
    | undefined;

  (a.colliders || [a]).forEach((colliderA) =>
    (b.colliders || [b]).forEach((colliderB) => {
      const shape = (collider: ShapeData) => {
        const result = collider.outline
          ? new PolygonShape(
              collider.outline.map(([x, y]) =>
                Vector(x, y).scale(physicsScale),
              ),
            )
          : new CircleShape(collider.radius * physicsScale);

        if (collider.outline && collider.collisionMargin !== undefined) {
          result.m_radius = collider.collisionMargin * physicsScale;
        }
        return result;
      };
      const sa = shape(colliderA),
        sb = shape(colliderB);
      const xa = new Transform(a.position.scale(physicsScale), a.rotation || 0);
      const xb = new Transform(b.position.scale(physicsScale), b.rotation || 0);
      const manifold = new Manifold();
      let reversed = false;

      if (sa instanceof PolygonShape && sb instanceof PolygonShape) {
        CollidePolygons(manifold, sa, xa, sb, xb);
      } else if (sa instanceof PolygonShape && sb instanceof CircleShape) {
        CollidePolygonCircle(manifold, sa, xa, sb, xb);
      } else if (sa instanceof CircleShape && sb instanceof PolygonShape) {
        CollidePolygonCircle(manifold, sb, xb, sa, xa);
        reversed = true;
      } else {
        CollideCircles(manifold, sa as CircleShape, xa, sb as CircleShape, xb);
      }

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
        aCollider: a.colliders ? colliderA : undefined,
        bCollider: b.colliders ? colliderB : undefined,
      };
    }),
  );
  return deepest;
};
