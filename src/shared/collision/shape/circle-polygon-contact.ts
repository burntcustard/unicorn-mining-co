/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/shape/CollideCirclePolygon.ts
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
import { PolygonShape } from './polygon-shape';
import { Manifold, vertexFeature } from '../contact-manifold';
import { Fixture } from '../../physics/fixture';

Contact.addType(
  PolygonShape.TYPE,
  CircleShape.TYPE,
  evaluatePolygonCircleContact,
);

function evaluatePolygonCircleContact(
  manifold: Manifold,
  xfA: TransformValue,
  fixtureA: Fixture,
  xfB: TransformValue,
  fixtureB: Fixture,
): void {
  collidePolygonCircle(
    manifold,
    fixtureA.getShape() as PolygonShape,
    xfA,
    fixtureB.getShape() as CircleShape,
    xfB,
  );
}

const cLocal = Vec.create();
const faceCenter = Vec.create();

export function collidePolygonCircle(
  manifold: Manifold,
  polygonA: PolygonShape,
  xfA: TransformValue,
  circleB: CircleShape,
  xfB: TransformValue,
): void {
  manifold.pointCount = 0;

  // Compute circle position in the frame of the polygon.
  matrix.changeTransformInto(cLocal, xfB, xfA, circleB.m_p);

  // Find the min separating edge.
  let normalIndex = 0;
  let separation = -Infinity;
  const radius = polygonA.m_radius + circleB.m_radius;
  const vertexCount = polygonA.m_count;
  const vertices = polygonA.m_vertices;
  const normals = polygonA.m_normals;

  for (let i = 0; i < vertexCount; ++i) {
    const s = Vec.dot(normals[i], cLocal) - Vec.dot(normals[i], vertices[i]);

    if (s > radius) {
      // Early out.
      return;
    }

    if (s > separation) {
      separation = s;
      normalIndex = i;
    }
  }

  // Vertices that subtend the incident face.
  const vertIndex1 = normalIndex;
  const vertIndex2 = vertIndex1 + 1 < vertexCount ? vertIndex1 + 1 : 0;
  const v1 = vertices[vertIndex1];
  const v2 = vertices[vertIndex2];

  // If the center is inside the polygon ...
  if (separation <= 0) {
    manifold.pointCount = 1;
    manifold.type = 'faceA';
    Vec.set(manifold.localNormal, normals[normalIndex]);
    Vec.combine2Into(manifold.localPoint, 0.5, v1, 0.5, v2);
    Vec.set(manifold.points[0].localPoint, circleB.m_p);

    manifold.points[0].id.setFeatures(0, vertexFeature, 0, vertexFeature);
    return;
  }

  // Compute barycentric coordinates
  // u1 = (cLocal - v1) dot (v2 - v1))
  const u1 =
    Vec.dot(cLocal, v2) -
    Vec.dot(cLocal, v1) -
    Vec.dot(v1, v2) +
    Vec.dot(v1, v1);
  // u2 = (cLocal - v2) dot (v1 - v2)
  const u2 =
    Vec.dot(cLocal, v1) -
    Vec.dot(cLocal, v2) -
    Vec.dot(v2, v1) +
    Vec.dot(v2, v2);

  if (u1 <= 0) {
    if (Vec.distanceSquared(cLocal, v1) > radius * radius) {
      return;
    }

    Vec.subtract(cLocal, v1, manifold.localNormal);
    Vec.normalize(manifold.localNormal, manifold.localNormal);
    Vec.set(manifold.localPoint, v1);
  } else if (u2 <= 0) {
    if (Vec.distanceSquared(cLocal, v2) > radius * radius) {
      return;
    }

    Vec.subtract(cLocal, v2, manifold.localNormal);
    Vec.normalize(manifold.localNormal, manifold.localNormal);
    Vec.set(manifold.localPoint, v2);
  } else {
    Vec.combine2Into(faceCenter, 0.5, v1, 0.5, v2);
    const separation =
      Vec.dot(cLocal, normals[vertIndex1]) -
      Vec.dot(faceCenter, normals[vertIndex1]);

    if (separation > radius) {
      return;
    }

    Vec.set(manifold.localNormal, normals[vertIndex1]);
    Vec.set(manifold.localPoint, faceCenter);
  }

  manifold.pointCount = 1;
  manifold.type = 'faceA';
  Vec.set(manifold.points[0].localPoint, circleB.m_p);
  manifold.points[0].id.setFeatures(0, vertexFeature, 0, vertexFeature);
}
