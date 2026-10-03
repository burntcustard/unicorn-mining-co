import * as Vec from '../../utilities/vector';
import * as matrix from '../../utilities/vector-math';
import { TransformValue } from '../../utilities/vector-math';
import { Contact } from '../../physics/contact';
import { CircleShape } from './circle-shape';
import { Manifold } from '../contact-manifold';
import { Fixture } from '../../physics/fixture';

Contact.addType(
  CircleShape.TYPE,
  CircleShape.TYPE,
  evaluateCircleCircleContact,
);

function evaluateCircleCircleContact(
  manifold: Manifold,
  xfA: TransformValue,
  fixtureA: Fixture,
  xfB: TransformValue,
  fixtureB: Fixture,
): void {
  collideCircles(
    manifold,
    fixtureA.getShape() as CircleShape,
    xfA,
    fixtureB.getShape() as CircleShape,
    xfB,
  );
}

const pA = Vec.create();
const pB = Vec.create();

export function collideCircles(
  manifold: Manifold,
  circleA: CircleShape,
  xfA: TransformValue,
  circleB: CircleShape,
  xfB: TransformValue,
): void {
  manifold.pointCount = 0;

  matrix.transformInto(pA, xfA, circleA.m_p);
  matrix.transformInto(pB, xfB, circleB.m_p);

  const distSqr = Vec.distanceSquared(pB, pA);
  const rA = circleA.m_radius;
  const rB = circleB.m_radius;
  const radius = rA + rB;

  if (distSqr > radius * radius) {
    return;
  }

  manifold.type = 'circles';
  Vec.set(manifold.localPoint, circleA.m_p);
  Vec.setXY(manifold.localNormal, 0, 0);
  manifold.pointCount = 1;
  Vec.set(manifold.points[0], circleB.m_p);
}
