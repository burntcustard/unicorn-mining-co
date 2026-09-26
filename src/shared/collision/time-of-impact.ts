/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/TimeOfImpact.ts
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

import * as Vec from '../vector';
import * as matrix from '../vector-math';
import { linearSlop } from '../settings';
import { Sweep } from '../physics/motion-sweep';
import {
  computeDistance,
  DistanceInput,
  DistanceOutput,
  DistanceProxy,
  SimplexCache,
} from './shape-distance';

/**
 * Input parameters for the time-of-impact query.
 */
export interface TOIInput {
  proxyA: DistanceProxy;
  proxyB: DistanceProxy;
  sweepA: Sweep;
  sweepB: Sweep;
  // Defines the sweep interval [0, tMax].
  tMax: number;
}

// Output parameters for the time-of-impact query.
export interface TOIOutput {
  touching: boolean;
  t: number;
}

const distanceOutput = new DistanceOutput();
// Passed to the distance query and separation function
const cache = new SimplexCache();

const xfA = matrix.transform(0, 0, 0);
const xfB = matrix.transform(0, 0, 0);
const distanceInput = new DistanceInput(xfA, xfB);
const temp = Vec.create();
const pointA = Vec.create();
const pointB = Vec.create();
const normal = Vec.create();
const axisA = Vec.create();
const axisB = Vec.create();
const localPointA = Vec.create();
const localPointB = Vec.create();

/**
 * Compute the upper bound on time before two shapes penetrate. Time is
 * represented as a fraction between [0,tMax]. This uses a swept separating axis
 * and may miss some intermediate, non-tunneling collisions. If you change the
 * time interval, you should call this function again.
 *
 * Use the distance query to compute the contact point and normal at the time of
 * impact.
 *
 * CCD via the local separating axis method. This seeks progression by computing
 * the largest time at which separation is maintained.
 */
export function findTimeOfImpact(output: TOIOutput, input: TOIInput): void {
  output.touching = false;
  output.t = input.tMax;

  const proxyA = input.proxyA; // DistanceProxy
  const proxyB = input.proxyB; // DistanceProxy

  const sweepA = input.sweepA; // Sweep
  const sweepB = input.sweepB; // Sweep

  // Large rotations can make the root finder fail, so we normalize the
  // sweep angles.
  sweepA.normalize();
  sweepB.normalize();

  const tMax = input.tMax;

  const totalRadius = proxyA.m_radius + proxyB.m_radius;
  const target = Math.max(linearSlop, totalRadius - 3 * linearSlop);
  const tolerance = 0.25 * linearSlop;

  let t1 = 0;
  const k_maxIterations = 20;
  let iter = 0;

  // Prepare input for distance query.
  cache.recycle();

  distanceInput.proxyA = proxyA;
  distanceInput.proxyB = proxyB;

  // The outer loop progressively attempts to compute new separating axes.
  // This loop terminates when an axis is repeated (no progress is made).
  while (true) {
    sweepA.getTransform(xfA, t1);
    sweepB.getTransform(xfB, t1);

    // Get the distance between shapes. We can also use the results
    // to get a separating axis.
    computeDistance(distanceOutput, cache, distanceInput);

    // If the shapes are overlapped, we give up on continuous collision.
    if (distanceOutput.distance <= 0) {
      // Failure!
      output.t = 0;
      break;
    }

    if (distanceOutput.distance < target + tolerance) {
      // Victory!
      output.touching = true;
      output.t = t1;
      break;
    }

    // Initialize the separating axis.
    separationFunction.initialize(cache, proxyA, sweepA, proxyB, sweepB, t1);

    // Compute the TOI on the separating axis. We do this by successively
    // resolving the deepest point. This loop is bounded by the number of
    // vertices.
    let done = false;
    let t2 = tMax;
    let pushBackIter = 0;
    const maxPushBackIterations = Math.max(12, proxyA.m_count, proxyB.m_count);

    while (true) {
      // Find the deepest point at t2. Store the witness point indices.
      let s2 = separationFunction.findMinSeparation(t2);

      // Is the final configuration separated?
      if (s2 > target + tolerance) {
        // Victory!
        output.t = tMax;
        done = true;
        break;
      }

      // Has the separation reached tolerance?
      if (s2 > target - tolerance) {
        // Advance the sweeps
        t1 = t2;
        break;
      }

      // Compute the initial separation of the witness points.
      let s1 = separationFunction.evaluate(t1);

      // Check for initial overlap. This might happen if the root finder
      // runs out of iterations.
      if (s1 < target - tolerance) {
        output.t = t1;
        done = true;
        break;
      }

      // Check for touching
      if (s1 <= target + tolerance) {
        // Victory! t1 should hold the TOI (could be 0).
        output.touching = true;
        output.t = t1;
        done = true;
        break;
      }

      // Compute 1D root of: f(x) - target = 0
      let rootIterCount = 0;
      let a1 = t1;
      let a2 = t2;

      while (true) {
        // Use a mix of the secant rule and bisection.
        let t;

        if (rootIterCount & 1) {
          // Secant rule to improve convergence.
          t = a1 + ((target - s1) * (a2 - a1)) / (s2 - s1);
        } else {
          // Bisection to guarantee progress.
          t = 0.5 * (a1 + a2);
        }

        ++rootIterCount;

        const s = separationFunction.evaluate(t);

        if (Math.abs(s - target) < tolerance) {
          // t2 holds a tentative value for t1
          t2 = t;
          break;
        }

        // Ensure we continue to bracket the root.
        if (s > target) {
          a1 = t;
          s1 = s;
        } else {
          a2 = t;
          s2 = s;
        }

        if (rootIterCount === 50) {
          break;
        }
      }

      ++pushBackIter;

      if (pushBackIter === maxPushBackIterations) {
        break;
      }
    }

    ++iter;

    if (done) {
      break;
    }

    if (iter === k_maxIterations) {
      // Root finder got stuck. Semi-victory.
      output.t = t1;
      break;
    }
  }

  separationFunction.recycle();
}

type SeparationFunctionType = 'points' | 'faceA' | 'faceB' | undefined;

class SeparationFunction {
  // input cache
  m_proxyA: DistanceProxy = null;
  m_proxyB: DistanceProxy = null;
  m_sweepA: Sweep = null;
  m_sweepB: Sweep = null;

  // initialize cache
  m_type: SeparationFunctionType = undefined;
  m_localPoint = Vec.create();
  m_axis = Vec.create();

  // compute output
  indexA = -1;
  indexB = -1;

  recycle() {
    this.m_proxyA = null;
    this.m_proxyB = null;
    this.m_sweepA = null;
    this.m_sweepB = null;

    this.m_type = undefined;
    Vec.setXY(this.m_localPoint, 0, 0);
    Vec.setXY(this.m_axis, 0, 0);

    this.indexA = -1;
    this.indexB = -1;
  }

  initialize(
    cache: SimplexCache,
    proxyA: DistanceProxy,
    sweepA: Sweep,
    proxyB: DistanceProxy,
    sweepB: Sweep,
    t1: number,
  ): number {
    const count = cache.count;

    this.m_proxyA = proxyA;
    this.m_proxyB = proxyB;
    this.m_sweepA = sweepA;
    this.m_sweepB = sweepB;

    this.m_sweepA.getTransform(xfA, t1);
    this.m_sweepB.getTransform(xfB, t1);

    if (count === 1) {
      this.m_type = 'points';
      const localPointA = this.m_proxyA.getVertex(cache.indexA[0]);
      const localPointB = this.m_proxyB.getVertex(cache.indexB[0]);

      matrix.transformInto(pointA, xfA, localPointA);
      matrix.transformInto(pointB, xfB, localPointB);
      Vec.subtract(pointB, pointA, this.m_axis);
      const s = Vec.length(this.m_axis);

      Vec.normalize(this.m_axis, this.m_axis);

      return s;
    } else if (cache.indexA[0] === cache.indexA[1]) {
      // Two points on B and one on A.
      this.m_type = 'faceB';
      const localPointB1 = proxyB.getVertex(cache.indexB[0]);
      const localPointB2 = proxyB.getVertex(cache.indexB[1]);

      Vec.crossScalarInto(
        this.m_axis,
        Vec.subtract(localPointB2, localPointB1, temp),
        1,
      );
      Vec.normalize(this.m_axis, this.m_axis);
      matrix.rotateInto(normal, xfB.q, this.m_axis);

      Vec.combine2Into(this.m_localPoint, 0.5, localPointB1, 0.5, localPointB2);
      matrix.transformInto(pointB, xfB, this.m_localPoint);

      const localPointA = proxyA.getVertex(cache.indexA[0]);

      matrix.transformInto(pointA, xfA, localPointA);

      let s = Vec.dot(pointA, normal) - Vec.dot(pointB, normal);

      if (s < 0) {
        Vec.scale(this.m_axis, -1, this.m_axis);
        s = -s;
      }
      return s;
    } else {
      // Two points on A and one or two points on B.
      this.m_type = 'faceA';
      const localPointA1 = this.m_proxyA.getVertex(cache.indexA[0]);
      const localPointA2 = this.m_proxyA.getVertex(cache.indexA[1]);

      Vec.crossScalarInto(
        this.m_axis,
        Vec.subtract(localPointA2, localPointA1, temp),
        1,
      );
      Vec.normalize(this.m_axis, this.m_axis);
      matrix.rotateInto(normal, xfA.q, this.m_axis);

      Vec.combine2Into(this.m_localPoint, 0.5, localPointA1, 0.5, localPointA2);
      matrix.transformInto(pointA, xfA, this.m_localPoint);

      const localPointB = this.m_proxyB.getVertex(cache.indexB[0]);

      matrix.transformInto(pointB, xfB, localPointB);

      let s = Vec.dot(pointB, normal) - Vec.dot(pointA, normal);

      if (s < 0) {
        Vec.scale(this.m_axis, -1, this.m_axis);
        s = -s;
      }
      return s;
    }
  }

  compute(find: boolean, t: number): number {
    // It was findMinSeparation and evaluate
    this.m_sweepA.getTransform(xfA, t);
    this.m_sweepB.getTransform(xfB, t);

    switch (this.m_type) {
      case 'points': {
        if (find) {
          matrix.unrotateInto(axisA, xfA.q, this.m_axis);
          matrix.unrotateInto(axisB, xfB.q, Vec.scale(this.m_axis, -1, temp));

          this.indexA = this.m_proxyA.getSupport(axisA);
          this.indexB = this.m_proxyB.getSupport(axisB);
        }

        Vec.set(localPointA, this.m_proxyA.getVertex(this.indexA));
        Vec.set(localPointB, this.m_proxyB.getVertex(this.indexB));

        matrix.transformInto(pointA, xfA, localPointA);
        matrix.transformInto(pointB, xfB, localPointB);

        const sep = Vec.dot(pointB, this.m_axis) - Vec.dot(pointA, this.m_axis);

        return sep;
      }

      case 'faceA': {
        matrix.rotateInto(normal, xfA.q, this.m_axis);
        matrix.transformInto(pointA, xfA, this.m_localPoint);

        if (find) {
          matrix.unrotateInto(axisB, xfB.q, Vec.scale(normal, -1, temp));

          this.indexA = -1;
          this.indexB = this.m_proxyB.getSupport(axisB);
        }

        Vec.set(localPointB, this.m_proxyB.getVertex(this.indexB));
        matrix.transformInto(pointB, xfB, localPointB);

        const sep = Vec.dot(pointB, normal) - Vec.dot(pointA, normal);

        return sep;
      }

      case 'faceB': {
        matrix.rotateInto(normal, xfB.q, this.m_axis);
        matrix.transformInto(pointB, xfB, this.m_localPoint);

        if (find) {
          matrix.unrotateInto(axisA, xfA.q, Vec.scale(normal, -1, temp));

          this.indexB = -1;
          this.indexA = this.m_proxyA.getSupport(axisA);
        }

        Vec.set(localPointA, this.m_proxyA.getVertex(this.indexA));
        matrix.transformInto(pointA, xfA, localPointA);

        const sep = Vec.dot(pointA, normal) - Vec.dot(pointB, normal);

        return sep;
      }

      default:
        if (find) {
          this.indexA = -1;
          this.indexB = -1;
        }
        return 0;
    }
  }

  findMinSeparation(t: number): number {
    return this.compute(true, t);
  }

  evaluate(t: number): number {
    return this.compute(false, t);
  }
}

const separationFunction = new SeparationFunction();
