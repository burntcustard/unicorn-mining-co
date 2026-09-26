/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/Distance.ts
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

import * as matrix from '../vector-math';
import * as Vec from '../vector';
import { type TransformValue } from '../vector-math';

const temp = Vec.create();
const e12 = Vec.create();
const e13 = Vec.create();
const e23 = Vec.create();
const temp1 = Vec.create();
const temp2 = Vec.create();
const minimumSearchDirectionSquared = 1e-18;
const minimumSimplexMetric = 1e-9;

/**
 * GJK using Voronoi regions (Christer Ericson) and Barycentric coordinates.
 */

// References the TOI inputs for one synchronous GJK query.
export class DistanceInput {
  proxyA!: DistanceProxy;
  proxyB!: DistanceProxy;

  constructor(
    readonly transformA: TransformValue,
    readonly transformB: TransformValue,
  ) {}
}

/**
 * Output for the distance query.
 */
export class DistanceOutput {
  // closest point on shapeA
  pointA = Vec.create();
  // closest point on shapeB
  pointB = Vec.create();
  distance = 0;
}

/**
 * Warm-starts the distance query. Set count to zero on the first call.
 */
export class SimplexCache {
  // length or area
  metric = 0;
  // vertices on shape A
  indexA: number[] = [];
  // vertices on shape B
  indexB: number[] = [];
  count = 0;
  recycle() {
    this.metric = 0;
    this.indexA.length = 0;
    this.indexB.length = 0;
    this.count = 0;
  }
}

/**
 * Compute the closest points between the game's circle and polygon shapes.
 * The simplex cache is input/output; set its count to zero on the first call.
 */
export function computeDistance(
  output: DistanceOutput,
  cache: SimplexCache,
  input: DistanceInput,
): void {
  const proxyA = input.proxyA;
  const proxyB = input.proxyB;
  const xfA = input.transformA;
  const xfB = input.transformB;

  // Initialize the simplex.
  simplex.recycle();
  simplex.readCache(cache, proxyA, xfA, proxyB, xfB);

  // Get simplex vertices as an array.
  const vertices = simplex.m_v;
  const maxIterations = 20;

  // These store the vertices of the last simplex so that we
  // can check for duplicates and prevent cycling.
  let saveCount = 0;

  // Main iteration loop.
  let iter = 0;

  while (iter < maxIterations) {
    // Copy simplex so we can identify duplicates.
    saveCount = simplex.m_count;

    for (let i = 0; i < saveCount; ++i) {
      saveA[i] = vertices[i].indexA;
      saveB[i] = vertices[i].indexB;
    }

    simplex.solve();

    // If we have 3 points, then the origin is in the corresponding triangle.
    if (simplex.m_count === 3) {
      break;
    }

    // Get search direction.
    const d = simplex.getSearchDirection();

    // Ensure the search direction is numerically fit.
    if (Vec.lengthSquared(d) < minimumSearchDirectionSquared) {
      // The origin is probably contained by a line segment
      // or triangle. Thus the shapes are overlapped.

      // We can't return zero here even though there may be overlap.
      // In case the simplex is a point, segment, or triangle it is difficult
      // to determine if the origin is contained in the CSO or very close to it.
      break;
    }

    // Compute a tentative new simplex vertex using support points.
    const vertex = vertices[simplex.m_count]; // SimplexVertex

    vertex.indexA = proxyA.getSupport(
      matrix.unrotateInto(temp, xfA.q, Vec.scale(d, -1, temp)),
    );
    matrix.transformInto(vertex.wA, xfA, proxyA.getVertex(vertex.indexA));

    vertex.indexB = proxyB.getSupport(matrix.unrotateInto(temp, xfB.q, d));
    matrix.transformInto(vertex.wB, xfB, proxyB.getVertex(vertex.indexB));

    Vec.subtract(vertex.wB, vertex.wA, vertex.w);

    // Iteration count is equated to the number of support point calls.
    ++iter;

    // Check for duplicate support points. This is the main termination
    // criteria.
    let duplicate = false;

    for (let i = 0; i < saveCount; ++i) {
      if (vertex.indexA === saveA[i] && vertex.indexB === saveB[i]) {
        duplicate = true;
        break;
      }
    }

    // If we found a duplicate support point we must exit to avoid cycling.
    if (duplicate) {
      break;
    }

    // New vertex is ok and needed.
    ++simplex.m_count;
  }

  // Prepare output.
  simplex.getWitnessPoints(output.pointA, output.pointB);
  output.distance = Vec.distance(output.pointA, output.pointB);

  // Cache the simplex.
  simplex.writeCache(cache);
}

/**
 * A distance proxy is used by the GJK algorithm. It encapsulates any shape.
 */
export class DistanceProxy {
  m_count = 0;
  m_vertices: Vec.Value[] = [];
  // The TOI target uses the shape skin radius.
  m_radius = 0;

  /**
   * Get a vertex by index for the distance query.
   */
  getVertex(index: number): Vec.Value {
    return this.m_vertices[index];
  }

  /**
   * Get the supporting vertex index in the given direction.
   */
  getSupport(d: Vec.Value): number {
    let bestIndex = -1;
    let bestValue = -Infinity;

    for (let i = 0; i < this.m_count; ++i) {
      const value = Vec.dot(this.m_vertices[i], d);

      if (value > bestValue) {
        bestIndex = i;
        bestValue = value;
      }
    }
    return bestIndex;
  }
}

class SimplexVertex {
  // support point in proxyA
  wA = Vec.create();
  // wA index
  indexA = 0;

  // support point in proxyB
  wB = Vec.create();
  // wB index
  indexB = 0;

  // wB - wA;
  w = Vec.create();
  // barycentric coordinate for closest point
  a = 0;

  recycle() {
    this.indexA = 0;
    this.indexB = 0;
    Vec.setXY(this.wA, 0, 0);
    Vec.setXY(this.wB, 0, 0);
    Vec.setXY(this.w, 0, 0);
    this.a = 0;
  }
  set(v: SimplexVertex): void {
    this.indexA = v.indexA;
    this.indexB = v.indexB;
    Vec.set(this.wA, v.wA);
    Vec.set(this.wB, v.wB);
    Vec.set(this.w, v.w);
    this.a = v.a;
  }
}

const searchDirection_reuse = Vec.create();

class Simplex {
  m_v1 = new SimplexVertex();
  m_v2 = new SimplexVertex();
  m_v3 = new SimplexVertex();
  m_v = [this.m_v1, this.m_v2, this.m_v3];
  m_count: number;
  recycle() {
    this.m_v1.recycle();
    this.m_v2.recycle();
    this.m_v3.recycle();
    this.m_count = 0;
  }

  toString(): string {
    if (this.m_count === 3) {
      return [
        '+' + this.m_count,
        this.m_v1.a,
        this.m_v1.wA.x,
        this.m_v1.wA.y,
        this.m_v1.wB.x,
        this.m_v1.wB.y,
        this.m_v2.a,
        this.m_v2.wA.x,
        this.m_v2.wA.y,
        this.m_v2.wB.x,
        this.m_v2.wB.y,
        this.m_v3.a,
        this.m_v3.wA.x,
        this.m_v3.wA.y,
        this.m_v3.wB.x,
        this.m_v3.wB.y,
      ].toString();
    } else if (this.m_count === 2) {
      return [
        '+' + this.m_count,
        this.m_v1.a,
        this.m_v1.wA.x,
        this.m_v1.wA.y,
        this.m_v1.wB.x,
        this.m_v1.wB.y,
        this.m_v2.a,
        this.m_v2.wA.x,
        this.m_v2.wA.y,
        this.m_v2.wB.x,
        this.m_v2.wB.y,
      ].toString();
    } else if (this.m_count === 1) {
      return [
        '+' + this.m_count,
        this.m_v1.a,
        this.m_v1.wA.x,
        this.m_v1.wA.y,
        this.m_v1.wB.x,
        this.m_v1.wB.y,
      ].toString();
    } else {
      return '+' + this.m_count;
    }
  }

  readCache(
    cache: SimplexCache,
    proxyA: DistanceProxy,
    transformA: TransformValue,
    proxyB: DistanceProxy,
    transformB: TransformValue,
  ): void {
    // Copy data from cache.
    this.m_count = cache.count;

    for (let i = 0; i < this.m_count; ++i) {
      const v = this.m_v[i];

      v.indexA = cache.indexA[i];
      v.indexB = cache.indexB[i];
      const wALocal = proxyA.getVertex(v.indexA);
      const wBLocal = proxyB.getVertex(v.indexB);

      matrix.transformInto(v.wA, transformA, wALocal);
      matrix.transformInto(v.wB, transformB, wBLocal);
      Vec.subtract(v.wB, v.wA, v.w);
      v.a = 0;
    }

    // Compute the new simplex metric, if it is substantially different than
    // old metric then flush the simplex.
    if (this.m_count > 1) {
      const metric1 = cache.metric;
      const metric2 = this.getMetric();

      if (
        metric2 < 0.5 * metric1 ||
        2 * metric1 < metric2 ||
        metric2 < minimumSimplexMetric
      ) {
        // Reset the simplex.
        this.m_count = 0;
      }
    }

    // If the cache is empty or invalid...
    if (this.m_count === 0) {
      const v = this.m_v[0];

      v.indexA = 0;
      v.indexB = 0;
      const wALocal = proxyA.getVertex(0);
      const wBLocal = proxyB.getVertex(0);

      matrix.transformInto(v.wA, transformA, wALocal);
      matrix.transformInto(v.wB, transformB, wBLocal);
      Vec.subtract(v.wB, v.wA, v.w);
      v.a = 1;
      this.m_count = 1;
    }
  }

  writeCache(cache: SimplexCache): void {
    cache.metric = this.getMetric();
    cache.count = this.m_count;

    for (let i = 0; i < this.m_count; ++i) {
      cache.indexA[i] = this.m_v[i].indexA;
      cache.indexB[i] = this.m_v[i].indexB;
    }
  }

  getSearchDirection(): Vec.Value {
    const v1 = this.m_v1;
    const v2 = this.m_v2;

    switch (this.m_count) {
      case 1:
        return Vec.setXY(searchDirection_reuse, -v1.w.x, -v1.w.y);

      case 2: {
        Vec.subtract(v2.w, v1.w, e12);
        const sgn = -Vec.cross(e12, v1.w);

        if (sgn > 0) {
          // Origin is left of e12.
          return Vec.setXY(searchDirection_reuse, -e12.y, e12.x);
        } else {
          // Origin is right of e12.
          return Vec.setXY(searchDirection_reuse, e12.y, -e12.x);
        }
      }

      default:
        return Vec.setXY(searchDirection_reuse, 0, 0);
    }
  }

  getWitnessPoints(pA: Vec.Value, pB: Vec.Value): void {
    const v1 = this.m_v1;
    const v2 = this.m_v2;
    const v3 = this.m_v3;

    switch (this.m_count) {
      case 0:
        break;

      case 1:
        Vec.set(pA, v1.wA);
        Vec.set(pB, v1.wB);
        break;

      case 2:
        Vec.combine2Into(pA, v1.a, v1.wA, v2.a, v2.wA);
        Vec.combine2Into(pB, v1.a, v1.wB, v2.a, v2.wB);
        break;

      case 3:
        Vec.combine3Into(pA, v1.a, v1.wA, v2.a, v2.wA, v3.a, v3.wA);
        Vec.set(pB, pA);
        break;

      default:
        break;
    }
  }

  getMetric(): number {
    switch (this.m_count) {
      case 0:
        return 0;

      case 1:
        return 0;

      case 2:
        return Vec.distance(this.m_v1.w, this.m_v2.w);

      case 3:
        return Vec.cross(
          Vec.subtract(this.m_v2.w, this.m_v1.w, temp1),
          Vec.subtract(this.m_v3.w, this.m_v1.w, temp2),
        );

      default:
        return 0;
    }
  }

  solve(): void {
    switch (this.m_count) {
      case 1:
        break;

      case 2:
        this.solve2();
        break;

      case 3:
        this.solve3();
        break;

      default:
    }
  }

  // Solve a line segment using barycentric coordinates.
  //
  // p = a1 * w1 + a2 * w2
  // a1 + a2 = 1
  //
  // The vector from the origin to the closest point on the line is
  // perpendicular to the line.
  // e12 = w2 - w1
  // dot(p, e) = 0
  // a1 * dot(w1, e) + a2 * dot(w2, e) = 0
  //
  // 2-by-2 linear system
  // [1 1 ][a1] = [1]
  // [w1.e12 w2.e12][a2] = [0]
  //
  // Define
  // d12_1 = dot(w2, e12)
  // d12_2 = -dot(w1, e12)
  // d12 = d12_1 + d12_2
  //
  // Solution
  // a1 = d12_1 / d12
  // a2 = d12_2 / d12
  solve2(): void {
    const w1 = this.m_v1.w;
    const w2 = this.m_v2.w;

    Vec.subtract(w2, w1, e12);

    // w1 region
    const d12_2 = -Vec.dot(w1, e12);

    if (d12_2 <= 0) {
      // a2 <= 0, so we clamp it to 0
      this.m_v1.a = 1;
      this.m_count = 1;
      return;
    }

    // w2 region
    const d12_1 = Vec.dot(w2, e12);

    if (d12_1 <= 0) {
      // a1 <= 0, so we clamp it to 0
      this.m_v2.a = 1;
      this.m_count = 1;
      this.m_v1.set(this.m_v2);
      return;
    }

    // Must be in e12 region.
    const inv_d12 = 1 / (d12_1 + d12_2);

    this.m_v1.a = d12_1 * inv_d12;
    this.m_v2.a = d12_2 * inv_d12;
    this.m_count = 2;
  }

  // Possible regions:
  // - points[2]
  // - edge points[0]-points[2]
  // - edge points[1]-points[2]
  // - inside the triangle
  solve3(): void {
    const w1 = this.m_v1.w;
    const w2 = this.m_v2.w;
    const w3 = this.m_v3.w;

    // Edge12
    // [1 1 ][a1] = [1]
    // [w1.e12 w2.e12][a2] = [0]
    // a3 = 0
    Vec.subtract(w2, w1, e12);
    const w1e12 = Vec.dot(w1, e12);
    const w2e12 = Vec.dot(w2, e12);
    const d12_1 = w2e12;
    const d12_2 = -w1e12;

    // Edge13
    // [1 1 ][a1] = [1]
    // [w1.e13 w3.e13][a3] = [0]
    // a2 = 0
    Vec.subtract(w3, w1, e13);
    const w1e13 = Vec.dot(w1, e13);
    const w3e13 = Vec.dot(w3, e13);
    const d13_1 = w3e13;
    const d13_2 = -w1e13;

    // Edge23
    // [1 1 ][a2] = [1]
    // [w2.e23 w3.e23][a3] = [0]
    // a1 = 0
    Vec.subtract(w3, w2, e23);
    const w2e23 = Vec.dot(w2, e23);
    const w3e23 = Vec.dot(w3, e23);
    const d23_1 = w3e23;
    const d23_2 = -w2e23;

    // Triangle123
    const n123 = Vec.cross(e12, e13);

    const d123_1 = n123 * Vec.cross(w2, w3);
    const d123_2 = n123 * Vec.cross(w3, w1);
    const d123_3 = n123 * Vec.cross(w1, w2);

    // w1 region
    if (d12_2 <= 0 && d13_2 <= 0) {
      this.m_v1.a = 1;
      this.m_count = 1;
      return;
    }

    // e12
    if (d12_1 > 0 && d12_2 > 0 && d123_3 <= 0) {
      const inv_d12 = 1 / (d12_1 + d12_2);

      this.m_v1.a = d12_1 * inv_d12;
      this.m_v2.a = d12_2 * inv_d12;
      this.m_count = 2;
      return;
    }

    // e13
    if (d13_1 > 0 && d13_2 > 0 && d123_2 <= 0) {
      const inv_d13 = 1 / (d13_1 + d13_2);

      this.m_v1.a = d13_1 * inv_d13;
      this.m_v3.a = d13_2 * inv_d13;
      this.m_count = 2;
      this.m_v2.set(this.m_v3);
      return;
    }

    // w2 region
    if (d12_1 <= 0 && d23_2 <= 0) {
      this.m_v2.a = 1;
      this.m_count = 1;
      this.m_v1.set(this.m_v2);
      return;
    }

    // w3 region
    if (d13_1 <= 0 && d23_1 <= 0) {
      this.m_v3.a = 1;
      this.m_count = 1;
      this.m_v1.set(this.m_v3);
      return;
    }

    // e23
    if (d23_1 > 0 && d23_2 > 0 && d123_1 <= 0) {
      const inv_d23 = 1 / (d23_1 + d23_2);

      this.m_v2.a = d23_1 * inv_d23;
      this.m_v3.a = d23_2 * inv_d23;
      this.m_count = 2;
      this.m_v1.set(this.m_v3);
      return;
    }

    // Must be in triangle123
    const inv_d123 = 1 / (d123_1 + d123_2 + d123_3);

    this.m_v1.a = d123_1 * inv_d123;
    this.m_v2.a = d123_2 * inv_d123;
    this.m_v3.a = d123_3 * inv_d123;
    this.m_count = 3;
  }
}

const simplex = new Simplex();
const saveA: number[] = [];
const saveB: number[] = [];
