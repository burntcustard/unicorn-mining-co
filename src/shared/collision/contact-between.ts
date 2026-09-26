import * as Vec from '../vector';
import { Manifold } from './contact-manifold';
import { CircleShape } from './shape/circle-shape';
import { PolygonShape } from './shape/polygon-shape';
import { collideCircles } from './shape/circle-circle-contact';
import { collidePolygons } from './shape/polygon-polygon-contact';
import { collidePolygonCircle } from './shape/circle-polygon-contact';
import { transform } from '../vector-math';
import { type Collider } from './types';

type ShapeData = Partial<Collider> & {
  position: Vec.Value;
  radius: number;
};

const shapeOf = (collider: ShapeData) =>
  collider.shapeOutline
    ? new PolygonShape(
        collider.shapeOutline.map(([x, y]) => Vec.create(x, y)),
        collider.collisionMargin,
      )
    : new CircleShape(Vec.create(), collider.radius);

/*
 * Read-only overlap query using the same narrow phase as the dynamics solver.
 * Contact skin is included: resting bodies need not geometrically penetrate.
 */
export const contactBetween = (a: ShapeData, b: ShapeData) => {
  const sa = shapeOf(a);
  const sb = shapeOf(b);
  const xa = transform(a.position.x, a.position.y, a.rotation || 0);
  const xb = transform(b.position.x, b.position.y, b.rotation || 0);
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

  return {
    depth: -Math.min(...contact.separations),
    normal: Vec.scale(Vec.clone(contact.normal), reversed ? -1 : 1),
    point: Vec.create(contact.points[0].x, contact.points[0].y),
  };
};
