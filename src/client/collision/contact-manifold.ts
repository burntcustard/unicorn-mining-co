/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/Manifold.ts
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

import * as matrix from '../utilities/vector-math';
import * as Vec from '../utilities/vector';
import { TransformValue } from '../utilities/vector-math';

const pointA = Vec.create();
const pointB = Vec.create();
const temp = Vec.create();
const cA = Vec.create();
const cB = Vec.create();
const dist = Vec.create();
const planePoint = Vec.create();
const clipPoint = Vec.create();
const minimumCircleNormalSquared = 1e-18;

export type ManifoldType = 'circles' | 'faceA' | 'faceB' | undefined;

/**
 * A manifold for two touching convex shapes. Manifolds are created in `evaluate`
 * method of Contact subclasses.
 *
 * Supported manifold types are e_faceA or e_faceB for clip point versus plane
 * with radius and e_circles point versus point with radius.
 *
 * We store contacts in this way so that position correction can account for
 * movement, which is critical for continuous physics. All contact scenarios
 * must be expressed in one of these types. This structure is stored across time
 * steps, so we keep it small.
 */
export class Manifold {
  type: ManifoldType;

  /**
   * Usage depends on manifold type:
   * - circles: not used
   * - faceA: the normal on polygonA
   * - faceB: the normal on polygonB
   */
  localNormal = Vec.create();

  /**
   * Usage depends on manifold type:
   * - circles: the local center of circleA
   * - faceA: the center of faceA
   * - faceB: the center of faceB
   */
  localPoint = Vec.create();

  // The points of contact
  points = [Vec.create(), Vec.create()];

  // The number of manifold points
  pointCount = 0;

  recycle(): void {
    this.type = undefined;
    Vec.setXY(this.localNormal, 0, 0);
    Vec.setXY(this.localPoint, 0, 0);
    this.pointCount = 0;
    Vec.setXY(this.points[0], 0, 0);
    Vec.setXY(this.points[1], 0, 0);
  }

  /**
   * Evaluate the manifold with supplied transforms. This assumes modest motion
   * from the original state. This does not change the point count, impulses, etc.
   * The radii must come from the shapes that generated the manifold.
   */
  getWorldManifold(
    wm: WorldManifold | null,
    xfA: TransformValue,
    radiusA: number,
    xfB: TransformValue,
    radiusB: number,
  ): WorldManifold {
    if (this.pointCount === 0) {
      return wm;
    }

    wm = wm || new WorldManifold();

    wm.pointCount = this.pointCount;

    const normal = wm.normal;
    const points = wm.points;
    const separations = wm.separations;

    switch (this.type) {
      case 'circles': {
        Vec.setXY(normal, 1, 0);
        const manifoldPoint = this.points[0];

        matrix.transformInto(pointA, xfA, this.localPoint);
        matrix.transformInto(pointB, xfB, manifoldPoint);
        Vec.subtract(pointB, pointA, dist);
        const lengthSqr = Vec.lengthSquared(dist);

        if (lengthSqr > minimumCircleNormalSquared) {
          const length = Math.sqrt(lengthSqr);

          Vec.scale(dist, 1 / length, normal);
        }
        Vec.addScaled(pointA, normal, radiusA, cA);
        Vec.addScaled(pointB, normal, -radiusB, cB);
        Vec.combine2Into(points[0], 0.5, cA, 0.5, cB);
        separations[0] = Vec.dot(Vec.subtract(cB, cA, temp), normal);
        break;
      }

      case 'faceA': {
        matrix.rotateInto(normal, xfA.q, this.localNormal);
        matrix.transformInto(planePoint, xfA, this.localPoint);

        for (let i = 0; i < this.pointCount; ++i) {
          const manifoldPoint = this.points[i];

          matrix.transformInto(clipPoint, xfB, manifoldPoint);
          Vec.addScaled(
            clipPoint,
            normal,
            radiusA -
              Vec.dot(Vec.subtract(clipPoint, planePoint, temp), normal),
            cA,
          );
          Vec.addScaled(clipPoint, normal, -radiusB, cB);
          Vec.combine2Into(points[i], 0.5, cA, 0.5, cB);
          separations[i] = Vec.dot(Vec.subtract(cB, cA, temp), normal);
        }
        break;
      }

      case 'faceB': {
        matrix.rotateInto(normal, xfB.q, this.localNormal);
        matrix.transformInto(planePoint, xfB, this.localPoint);

        for (let i = 0; i < this.pointCount; ++i) {
          const manifoldPoint = this.points[i];

          matrix.transformInto(clipPoint, xfA, manifoldPoint);
          Vec.addScaled(
            clipPoint,
            normal,
            radiusB -
              Vec.dot(Vec.subtract(clipPoint, planePoint, temp), normal),
            cB,
          );
          Vec.addScaled(clipPoint, normal, -radiusA, cA);
          Vec.combine2Into(points[i], 0.5, cA, 0.5, cB);
          separations[i] = Vec.dot(Vec.subtract(cA, cB, temp), normal);
        }
        // Ensure normal points from A to B.
        Vec.scale(normal, -1, normal);
        break;
      }
    }

    return wm;
  }
}

/**
 * This is used to compute the current state of a contact manifold.
 */
export class WorldManifold {
  // World vector pointing from A to B
  normal = Vec.create();

  // World contact point (point of intersection)
  points = [Vec.create(), Vec.create()]; // [maxManifoldPoints]

  // A negative value indicates overlap, in meters
  separations = [0, 0]; // [maxManifoldPoints]

  // The number of manifold points
  pointCount = 0;

  recycle() {
    Vec.setXY(this.normal, 0, 0);
    Vec.setXY(this.points[0], 0, 0);
    Vec.setXY(this.points[1], 0, 0);
    this.separations[0] = 0;
    this.separations[1] = 0;
    this.pointCount = 0;
  }
}

/**
 * Clipping for contact manifolds. Sutherland-Hodgman clipping.
 */
export function clipSegmentToLine(
  vOut: Vec.Value[],
  vIn: Vec.Value[],
  normal: Vec.Value,
  offset: number,
): number {
  // Start with no output points
  let numOut = 0;

  // Calculate the distance of end points to the line
  const distance0 = Vec.dot(normal, vIn[0]) - offset;
  const distance1 = Vec.dot(normal, vIn[1]) - offset;

  // If the points are behind the plane
  if (distance0 <= 0) Vec.set(vOut[numOut++], vIn[0]);

  if (distance1 <= 0) Vec.set(vOut[numOut++], vIn[1]);

  // If the points are on different sides of the plane
  if (distance0 * distance1 < 0) {
    // Find intersection point of edge and plane
    const interp = distance0 / (distance0 - distance1);

    Vec.combine2Into(vOut[numOut], 1 - interp, vIn[0], interp, vIn[1]);

    ++numOut;
  }

  return numOut;
}
