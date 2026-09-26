/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/shape/PolygonShape.ts
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
import { AABBValue } from '../axis-aligned-bounds';
import { DistanceProxy } from '../shape-distance';
import { TransformValue } from '../../vector-math';
import { linearSlop } from '../../settings';
import { Shape } from './base';

const temp = Vec.create();

/**
 * A convex polygon. It is assumed that the interior of the polygon is to the
 * left of each edge.
 */
export class PolygonShape extends Shape {
  declare m_type: 'polygon';
  m_centroid: Vec.Value;
  m_vertices: Vec.Value[];
  m_normals: Vec.Value[];
  m_count: number;
  static TYPE = 'polygon' as const;

  declare m_radius: number;

  constructor(vertices: Vec.Value[], collisionMargin?: number) {
    super();

    this.m_type = PolygonShape.TYPE;
    this.m_radius = collisionMargin ?? 2 * linearSlop;
    this.m_centroid = Vec.create();
    this.m_vertices = [];
    this.m_normals = [];
    this.m_count = 0;

    if (vertices.length) {
      this._set(vertices);
    }
  }

  /**
   * Create a convex hull from at least three local points.
   *
   * Warning: the points may be re-ordered, even if they form a convex polygon
   * Warning: collinear points are handled but not removed. Collinear points may
   * lead to poor stacking behavior.
   */
  _set(vertices: Vec.Value[]): void {
    if (vertices.length < 3) {
      this._setAsBox(100, 100);
      return;
    }

    let n = vertices.length;

    // Perform welding and copy vertices into local buffer.
    const ps: Vec.Value[] = [];

    for (let i = 0; i < n; ++i) {
      const v = vertices[i];

      let unique = true;

      for (let j = 0; j < ps.length; ++j) {
        if (Vec.distanceSquared(v, ps[j]) < 0.25 * (linearSlop * linearSlop)) {
          unique = false;
          break;
        }
      }

      if (unique) {
        ps.push(Vec.clone(v));
      }
    }

    n = ps.length;

    if (n < 3) {
      // Polygon is degenerate.
      this._setAsBox(100, 100);
      return;
    }

    // Create the convex hull using the Gift wrapping algorithm
    // http://en.wikipedia.org/wiki/Gift_wrapping_algorithm

    // Find the right most point on the hull (in case of multiple points bottom most is used)
    let i0 = 0;
    let x0 = ps[0].x;

    for (let i = 1; i < n; ++i) {
      const x = ps[i].x;

      if (x > x0 || (x === x0 && ps[i].y < ps[i0].y)) {
        i0 = i;
        x0 = x;
      }
    }

    const hull: number[] = [];
    let m = 0;
    let ih = i0;

    for (;;) {
      hull[m] = ih;

      let ie = 0;
      const origin = ps[ih];

      for (let j = 1; j < n; ++j) {
        if (ie === ih) {
          ie = j;
          continue;
        }

        const rx = ps[ie].x - origin.x;
        const ry = ps[ie].y - origin.y;
        const vx = ps[j].x - origin.x;
        const vy = ps[j].y - origin.y;
        const cross = rx * vy - ry * vx;

        // Negative cross wraps counter-clockwise.
        if (cross < 0) {
          ie = j;
        }

        if (cross === 0 && vx * vx + vy * vy > rx * rx + ry * ry) {
          ie = j;
        }
      }

      ++m;
      ih = ie;

      if (ie === i0) {
        break;
      }
    }

    if (m < 3) {
      // Polygon is degenerate.
      this._setAsBox(100, 100);
      return;
    }

    this.m_count = m;

    this.m_vertices = hull.map((index) => ps[index]);

    // Compute normals. Ensure the edges have non-zero length.
    this.m_normals = this.m_vertices.map((vertex, index) => {
      const next = this.m_vertices[(index + 1) % m];
      const normal = Vec.create(next.y - vertex.y, vertex.x - next.x);

      Vec.normalize(normal, normal);
      return normal;
    });

    // Compute the polygon centroid.
    this.m_centroid = computeCentroid(this.m_vertices, m);
  }

  /**
   * Fallback shape for degenerate input.
   */
  _setAsBox(hx: number, hy: number): void {
    // start with right-bottom, counter-clockwise, as in Gift wrapping algorithm in PolygonShape._set()
    this.m_vertices[0] = Vec.create(hx, -hy);
    this.m_vertices[1] = Vec.create(hx, hy);
    this.m_vertices[2] = Vec.create(-hx, hy);
    this.m_vertices[3] = Vec.create(-hx, -hy);

    this.m_normals[0] = Vec.create(1, 0);
    this.m_normals[1] = Vec.create(0, 1);
    this.m_normals[2] = Vec.create(-1, 0);
    this.m_normals[3] = Vec.create(0, -1);

    this.m_count = 4;
  }

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   */
  computeAABB(aabb: AABBValue, xf: TransformValue): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < this.m_count; ++i) {
      const v = matrix.transformInto(temp, xf, this.m_vertices[i]);

      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }

    Vec.setXY(aabb.lowerBound, minX - this.m_radius, minY - this.m_radius);
    Vec.setXY(aabb.upperBound, maxX + this.m_radius, maxY + this.m_radius);
  }

  computeDistanceProxy(proxy: DistanceProxy): void {
    for (let i = 0; i < this.m_count; ++i) {
      proxy.m_vertices[i] = this.m_vertices[i];
    }
    proxy.m_vertices.length = this.m_count;
    proxy.m_count = this.m_count;
    proxy.m_radius = this.m_radius;
  }
}

function computeCentroid(vs: Vec.Value[], count: number): Vec.Value {
  const c = Vec.create();
  let area = 0;

  // pRef is the reference point for forming triangles.
  // It's location doesn't change the result (except for rounding error).
  const pRef = Vec.create();

  const inv3 = 1 / 3;

  for (let i = 0; i < count; ++i) {
    // Triangle vertices.
    const p1 = pRef;
    const p2 = vs[i];
    const p3 = i + 1 < count ? vs[i + 1] : vs[0];

    const D = Vec.cross(p2, p3);

    const triangleArea = 0.5 * D;

    area += triangleArea;

    // Area weighted centroid
    Vec.combine3Into(temp, 1, p1, 1, p2, 1, p3);
    Vec.addScaled(c, temp, triangleArea * inv3, c);
  }

  // Centroid
  Vec.scale(c, 1 / area, c);
  return c;
}

export { PolygonShape as Polygon };
