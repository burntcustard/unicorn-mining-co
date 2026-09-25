/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/shape/CollideCircle.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/*
 * Planck.js
 *
 * Copyright (c) Erin Catto, Ali Shakiba
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as Vec from '../../vector';
import * as matrix from '../../vector-math';
import { TransformValue } from '../../vector-math';
import { Contact } from '../../physics/contact';
import { CircleShape } from './circle-shape';
import { Manifold, vertexFeature } from '../contact-manifold';
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
  Vec.set(manifold.points[0].localPoint, circleB.m_p);

  manifold.points[0].id.setFeatures(0, vertexFeature, 0, vertexFeature);
}
