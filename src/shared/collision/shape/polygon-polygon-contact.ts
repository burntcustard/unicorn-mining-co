/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/shape/CollidePolygon.ts
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
import { TransformValue } from '../../vector-math';
import * as matrix from '../../vector-math';
import { linearSlop } from '../../settings';
import {
  Manifold,
  clipSegmentToLine,
  ClipVertex,
  faceFeature,
  vertexFeature,
} from '../contact-manifold';
import { Contact } from '../../physics/contact';
import { PolygonShape } from './polygon-shape';
import { Fixture } from '../../physics/fixture';

const incidentEdge = [new ClipVertex(), new ClipVertex()];
const clipPoints1 = [new ClipVertex(), new ClipVertex()];
const clipPoints2 = [new ClipVertex(), new ClipVertex()];
const clipSegmentToLineNormal = Vec.create();
const v1 = Vec.create();
const n = Vec.create();
const xf = matrix.transform(0, 0, 0);
const v11 = Vec.create();
const v12 = Vec.create();
const localTangent = Vec.create();
const localNormal = Vec.create();
const planePoint = Vec.create();
const tangent = Vec.create();
const normal = Vec.create();
const normal1 = Vec.create();

Contact.addType(PolygonShape.TYPE, PolygonShape.TYPE, evaluatePolygonContact);

function evaluatePolygonContact(
  manifold: Manifold,
  xfA: TransformValue,
  fixtureA: Fixture,
  xfB: TransformValue,
  fixtureB: Fixture,
): void {
  collidePolygons(
    manifold,
    fixtureA.getShape() as PolygonShape,
    xfA,
    fixtureB.getShape() as PolygonShape,
    xfB,
  );
}

interface MaxSeparation {
  maxSeparation: number;
  bestIndex: number;
}

/**
 * Find the max separation between poly1 and poly2 using edge normals from
 * poly1.
 */
function findMaxSeparation(
  poly1: PolygonShape,
  xf1: TransformValue,
  poly2: PolygonShape,
  xf2: TransformValue,
  output: MaxSeparation,
): void {
  const count1 = poly1.m_count;
  const count2 = poly2.m_count;
  const n1s = poly1.m_normals;
  const v1s = poly1.m_vertices;
  const v2s = poly2.m_vertices;

  matrix.detransformTransform(xf, xf2, xf1);

  let bestIndex = 0;
  let maxSeparation = -Infinity;

  for (let i = 0; i < count1; ++i) {
    // Get poly1 normal in frame2.
    matrix.rotateInto(n, xf.q, n1s[i]);
    matrix.transformInto(v1, xf, v1s[i]);

    // Find deepest point for normal i.
    let si = Infinity;

    for (let j = 0; j < count2; ++j) {
      const sij = Vec.dot(n, v2s[j]) - Vec.dot(n, v1);

      if (sij < si) {
        si = sij;
      }
    }

    if (si > maxSeparation) {
      maxSeparation = si;
      bestIndex = i;
    }
  }

  // used to keep last FindMaxSeparation call values
  output.maxSeparation = maxSeparation;
  output.bestIndex = bestIndex;
}

function findIncidentEdge(
  clipVertex: ClipVertex[],
  poly1: PolygonShape,
  xf1: TransformValue,
  edge1: number,
  poly2: PolygonShape,
  xf2: TransformValue,
): void {
  const normals1 = poly1.m_normals;

  const count2 = poly2.m_count;
  const vertices2 = poly2.m_vertices;
  const normals2 = poly2.m_normals;

  // Get the normal of the reference edge in poly2's frame.
  matrix.rerotateInto(normal1, xf2.q, xf1.q, normals1[edge1]);

  // Find the incident edge on poly2.
  let index = 0;
  let minDot = Infinity;

  for (let i = 0; i < count2; ++i) {
    const dot = Vec.dot(normal1, normals2[i]);

    if (dot < minDot) {
      minDot = dot;
      index = i;
    }
  }

  // Build the clip vertices for the incident edge.
  const i1 = index;
  const i2 = i1 + 1 < count2 ? i1 + 1 : 0;

  matrix.transformInto(clipVertex[0].v, xf2, vertices2[i1]);
  clipVertex[0].id.setFeatures(edge1, faceFeature, i1, vertexFeature);

  matrix.transformInto(clipVertex[1].v, xf2, vertices2[i2]);
  clipVertex[1].id.setFeatures(edge1, faceFeature, i2, vertexFeature);
}

const maxSeparation = {
  maxSeparation: 0,
  bestIndex: 0,
};

/**
 *
 * Find edge normal of max separation on A - return if separating axis is found
 * Find edge normal of max separation on B - return if separation axis is found
 * Choose reference edge as min(minA, minB)
 * Find incident edge
 * Clip
 *
 * The normal points from 1 to 2
 */
export function collidePolygons(
  manifold: Manifold,
  polyA: PolygonShape,
  xfA: TransformValue,
  polyB: PolygonShape,
  xfB: TransformValue,
): void {
  manifold.pointCount = 0;
  const totalRadius = polyA.m_radius + polyB.m_radius;

  findMaxSeparation(polyA, xfA, polyB, xfB, maxSeparation);
  const edgeA = maxSeparation.bestIndex;
  const separationA = maxSeparation.maxSeparation;

  if (separationA > totalRadius) return;

  findMaxSeparation(polyB, xfB, polyA, xfA, maxSeparation);
  const edgeB = maxSeparation.bestIndex;
  const separationB = maxSeparation.maxSeparation;

  if (separationB > totalRadius) return;

  let poly1: PolygonShape; // reference polygon
  let poly2: PolygonShape; // incident polygon
  let xf1: TransformValue;
  let xf2: TransformValue;
  let edge1: number; // reference edge
  let flip: boolean;
  const k_tol = 0.1 * linearSlop;

  if (separationB > separationA + k_tol) {
    poly1 = polyB;
    poly2 = polyA;
    xf1 = xfB;
    xf2 = xfA;
    edge1 = edgeB;
    manifold.type = 'faceB';
    flip = true;
  } else {
    poly1 = polyA;
    poly2 = polyB;
    xf1 = xfA;
    xf2 = xfB;
    edge1 = edgeA;
    manifold.type = 'faceA';
    flip = false;
  }

  incidentEdge[0].recycle();
  incidentEdge[1].recycle();
  findIncidentEdge(incidentEdge, poly1, xf1, edge1, poly2, xf2);

  const count1 = poly1.m_count;
  const vertices1 = poly1.m_vertices;

  const iv1 = edge1;
  const iv2 = edge1 + 1 < count1 ? edge1 + 1 : 0;

  Vec.set(v11, vertices1[iv1]);
  Vec.set(v12, vertices1[iv2]);

  Vec.subtract(v12, v11, localTangent);
  Vec.normalize(localTangent, localTangent);

  Vec.crossScalarInto(localNormal, localTangent, 1);
  Vec.combine2Into(planePoint, 0.5, v11, 0.5, v12);

  matrix.rotateInto(tangent, xf1.q, localTangent);
  Vec.crossScalarInto(normal, tangent, 1);

  matrix.transformInto(v11, xf1, v11);
  matrix.transformInto(v12, xf1, v12);

  // Face offset.
  const frontOffset = Vec.dot(normal, v11);

  // Side offsets, extended by polytope skin thickness.
  const sideOffset1 = -Vec.dot(tangent, v11) + totalRadius;
  const sideOffset2 = Vec.dot(tangent, v12) + totalRadius;

  // Clip incident edge against extruded edge1 side edges.
  clipPoints1[0].recycle();
  clipPoints1[1].recycle();
  clipPoints2[0].recycle();
  clipPoints2[1].recycle();

  // Clip to box side 1
  Vec.setXY(clipSegmentToLineNormal, -tangent.x, -tangent.y);
  const np1 = clipSegmentToLine(
    clipPoints1,
    incidentEdge,
    clipSegmentToLineNormal,
    sideOffset1,
    iv1,
  );

  if (np1 < 2) {
    return;
  }

  // Clip to negative box side 1
  Vec.setXY(clipSegmentToLineNormal, tangent.x, tangent.y);
  const np2 = clipSegmentToLine(
    clipPoints2,
    clipPoints1,
    clipSegmentToLineNormal,
    sideOffset2,
    iv2,
  );

  if (np2 < 2) {
    return;
  }

  // Now clipPoints2 contains the clipped points.
  Vec.set(manifold.localNormal, localNormal);
  Vec.set(manifold.localPoint, planePoint);

  let pointCount = 0;

  for (let i = 0; i < clipPoints2.length /* maxManifoldPoints */; ++i) {
    const separation = Vec.dot(normal, clipPoints2[i].v) - frontOffset;

    if (separation <= totalRadius) {
      const cp = manifold.points[pointCount];

      matrix.inverseTransformInto(cp.localPoint, xf2, clipPoints2[i].v);
      cp.id.set(clipPoints2[i].id);

      if (flip) {
        // Swap features
        cp.id.swapFeatures();
      }
      ++pointCount;
    }
  }

  manifold.pointCount = pointCount;
}
