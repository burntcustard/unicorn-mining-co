import { Manifold } from './contact-manifold';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import { collideCircles } from './shape/circle-circle-contact';
import { collidePolygons } from './shape/polygon-polygon-contact';
import { collidePolygonCircle } from './shape/circle-polygon-contact';
import { Transform } from '../common/physics-transform';
import { Vector } from '../vector';
import { type Collider } from './types';

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
      const [sa, sb] = [colliderA, colliderB].map((collider) =>
        collider.outline
          ? new PolygonShape(
              collider.outline.map(([x, y]) => Vector(x, y)),
              collider.collisionMargin,
            )
          : new CircleShape(Vector(), collider.radius),
      );
      const xa = new Transform(a.position, a.rotation || 0);
      const xb = new Transform(b.position, b.rotation || 0);
      const manifold = new Manifold();
      let reversed = false;

      if (sa instanceof PolygonShape && sb instanceof PolygonShape) {
        collidePolygons(manifold, sa, xa, sb, xb);
      } else if (sa instanceof PolygonShape && sb instanceof CircleShape) {
        collidePolygonCircle(manifold, sa, xa, sb, xb);
      } else if (sa instanceof CircleShape && sb instanceof PolygonShape) {
        collidePolygonCircle(manifold, sb, xb, sa, xa);
        reversed = true;
      } else {
        collideCircles(manifold, sa as CircleShape, xa, sb as CircleShape, xb);
      }

      if (!manifold.pointCount) return;
      const contact = reversed
        ? manifold.getWorldManifold(null, xb, sb.m_radius, xa, sa.m_radius)
        : manifold.getWorldManifold(null, xa, sa.m_radius, xb, sb.m_radius);
      const depth = -Math.min(...contact.separations);

      if (deepest && deepest.depth >= depth) return;
      deepest = {
        depth,
        normal: Vector(contact.normal.x, contact.normal.y).scale(
          reversed ? -1 : 1,
        ),
        point: Vector(contact.points[0].x, contact.points[0].y),
        aCollider: a.colliders ? colliderA : undefined,
        bCollider: b.colliders ? colliderB : undefined,
      };
    }),
  );
  return deepest;
};
