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

import * as matrix from '../../common/physics-matrix';
import type { MassData } from '../../dynamics/physics-body';
import { AABBValue } from '../axis-aligned-bounds';
import { DistanceProxy } from '../shape-distance';
import { EPSILON } from '../../common/physics-math';
import { Transform, TransformValue } from '../../common/physics-transform';
import { Rot } from '../../common/physics-rotation';
import { Vec2, Vec2Value } from '../../common/physics-vector';
import { SettingsInternal as Settings } from '../../common/engine-settings';
import { Shape } from '../collision-shape';

/** @internal */ const _ASSERT = false;
/** @internal */ const math_max = Math.max;
/** @internal */ const math_min = Math.min;

/** @internal */ const temp = matrix.vec2(0, 0);
/** @internal */ const e1 = matrix.vec2(0, 0);
/** @internal */ const e2 = matrix.vec2(0, 0);
/** @internal */ const center = matrix.vec2(0, 0);
/** @internal */ const s = matrix.vec2(0, 0);

/**
 * A convex polygon. It is assumed that the interior of the polygon is to the
 * left of each edge. Polygons have a maximum number of vertices equal to
 * Settings.maxPolygonVertices. In most cases you should not need many vertices
 * for a convex polygon. extends Shape
 */
export class PolygonShape extends Shape {
  static TYPE = 'polygon' as const;
  /** @hidden */ declare m_type: 'polygon';

  /** @hidden */ m_centroid: Vec2;
  /** @hidden */ m_vertices: Vec2[]; // [Settings.maxPolygonVertices]
  /** @hidden */ m_normals: Vec2[]; // [Settings.maxPolygonVertices]
  /** @hidden */ m_count: number;
  /** @hidden */ declare m_radius: number;

  constructor(vertices?: Vec2Value[]) {
    super();

    this.m_type = PolygonShape.TYPE;
    this.m_radius = Settings.polygonRadius;
    this.m_centroid = Vec2.zero();
    this.m_vertices = [];
    this.m_normals = [];
    this.m_count = 0;

    if (vertices && vertices.length) {
      this._set(vertices);
    }
  }

  getType(): 'polygon' {
    return this.m_type;
  }

  getRadius(): number {
    return this.m_radius;
  }

  /**
   * Get the number of child primitives.
   */
  getChildCount(): 1 {
    return 1;
  }

  /**
   * @internal
   *
   * Create a convex hull from the given array of local points. The count must be
   * in the range [3, Settings.maxPolygonVertices].
   *
   * Warning: the points may be re-ordered, even if they form a convex polygon
   * Warning: collinear points are handled but not removed. Collinear points may
   * lead to poor stacking behavior.
   */
  _set(vertices: Vec2Value[]): void {
    if (_ASSERT) {
      console.assert(
        3 <= vertices.length && vertices.length <= Settings.maxPolygonVertices,
      );
    }

    if (vertices.length < 3) {
      this._setAsBox(1.0, 1.0);
      return;
    }

    let n = math_min(vertices.length, Settings.maxPolygonVertices);

    // Perform welding and copy vertices into local buffer.
    const ps: Vec2[] = [];

    // [Settings.maxPolygonVertices];
    for (let i = 0; i < n; ++i) {
      const v = vertices[i];

      let unique = true;

      for (let j = 0; j < ps.length; ++j) {
        if (
          Vec2.distanceSquared(v, ps[j]) <
          0.25 * Settings.linearSlopSquared
        ) {
          unique = false;
          break;
        }
      }

      if (unique) {
        ps.push(Vec2.clone(v));
      }
    }

    n = ps.length;

    if (n < 3) {
      // Polygon is degenerate.
      if (_ASSERT) console.assert(false);
      this._setAsBox(1.0, 1.0);
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

    const hull = [] as number[]; // [Settings.maxPolygonVertices];
    let m = 0;
    let ih = i0;

    for (;;) {
      if (_ASSERT) console.assert(m < Settings.maxPolygonVertices);
      hull[m] = ih;

      let ie = 0;

      for (let j = 1; j < n; ++j) {
        if (ie === ih) {
          ie = j;
          continue;
        }

        const r = Vec2.sub(ps[ie], ps[hull[m]]);
        const v = Vec2.sub(ps[j], ps[hull[m]]);
        const c = Vec2.crossVec2Vec2(r, v);

        // c < 0 means counter-clockwise wrapping, c > 0 means clockwise wrapping
        if (c < 0.0) {
          ie = j;
        }

        // Collinearity check
        if (c === 0.0 && v.lengthSquared() > r.lengthSquared()) {
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
      if (_ASSERT) console.assert(false);
      this._setAsBox(1.0, 1.0);
      return;
    }

    this.m_count = m;

    // Copy vertices.
    this.m_vertices = [];

    for (let i = 0; i < m; ++i) {
      this.m_vertices[i] = ps[hull[i]];
    }

    // Compute normals. Ensure the edges have non-zero length.
    for (let i = 0; i < m; ++i) {
      const i1 = i;
      const i2 = i + 1 < m ? i + 1 : 0;
      const edge = Vec2.sub(this.m_vertices[i2], this.m_vertices[i1]);

      if (_ASSERT) console.assert(edge.lengthSquared() > EPSILON * EPSILON);
      this.m_normals[i] = Vec2.crossVec2Num(edge, 1.0);
      this.m_normals[i].normalize();
    }

    // Compute the polygon centroid.
    this.m_centroid = computeCentroid(this.m_vertices, m);
  }

  /** @internal */ _setAsBox(
    hx: number,
    hy: number,
    center?: Vec2Value,
    angle?: number,
  ): void {
    // start with right-bottom, counter-clockwise, as in Gift wrapping algorithm in PolygonShape._set()
    this.m_vertices[0] = Vec2.neo(hx, -hy);
    this.m_vertices[1] = Vec2.neo(hx, hy);
    this.m_vertices[2] = Vec2.neo(-hx, hy);
    this.m_vertices[3] = Vec2.neo(-hx, -hy);

    this.m_normals[0] = Vec2.neo(1.0, 0.0);
    this.m_normals[1] = Vec2.neo(0.0, 1.0);
    this.m_normals[2] = Vec2.neo(-1.0, 0.0);
    this.m_normals[3] = Vec2.neo(0.0, -1.0);

    this.m_count = 4;

    if (center && Vec2.isValid(center)) {
      angle = angle || 0;

      matrix.copyVec2(this.m_centroid, center);

      const xf = Transform.identity();

      xf.p.setVec2(center);
      xf.q.setAngle(angle);

      // Transform vertices and normals.
      for (let i = 0; i < this.m_count; ++i) {
        this.m_vertices[i] = Transform.mulVec2(xf, this.m_vertices[i]);
        this.m_normals[i] = Rot.mulVec2(xf.q, this.m_normals[i]);
      }
    }
  }

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * child shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   * @param childIndex The child shape
   */
  computeAABB(aabb: AABBValue, xf: TransformValue, _childIndex: number): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < this.m_count; ++i) {
      const v = matrix.transformVec2(temp, xf, this.m_vertices[i]);

      minX = math_min(minX, v.x);
      maxX = math_max(maxX, v.x);
      minY = math_min(minY, v.y);
      maxY = math_max(maxY, v.y);
    }

    matrix.setVec2(aabb.lowerBound, minX - this.m_radius, minY - this.m_radius);
    matrix.setVec2(aabb.upperBound, maxX + this.m_radius, maxY + this.m_radius);
  }

  /**
   * Compute the mass properties of this shape using its dimensions and density.
   * The inertia tensor is computed about the local origin.
   *
   * @param massData Returns the mass data for this shape.
   * @param density The density in kilograms per meter squared.
   */
  computeMass(massData: MassData, density: number): void {
    // Polygon mass, centroid, and inertia.
    // Let rho be the polygon density in mass per unit area.
    // Then:
    // mass = rho * int(dA)
    // centroid.x = (1/mass) * rho * int(x * dA)
    // centroid.y = (1/mass) * rho * int(y * dA)
    // I = rho * int((x*x + y*y) * dA)
    //
    // We can compute these integrals by summing all the integrals
    // for each triangle of the polygon. To evaluate the integral
    // for a single triangle, we make a change of variables to
    // the (u,v) coordinates of the triangle:
    // x = x0 + e1x * u + e2x * v
    // y = y0 + e1y * u + e2y * v
    // where 0 <= u && 0 <= v && u + v <= 1.
    //
    // We integrate u from [0,1-v] and then v from [0,1].
    // We also need to use the Jacobian of the transformation:
    // D = cross(e1, e2)
    //
    // Simplification: triangle centroid = (1/3) * (p1 + p2 + p3)
    //
    // The rest of the derivation is handled by computer algebra.

    if (_ASSERT) console.assert(this.m_count >= 3);

    matrix.zeroVec2(center);
    let area = 0.0;
    let I = 0.0;

    // s is the reference point for forming triangles.
    // It's location doesn't change the result (except for rounding error).
    matrix.zeroVec2(s);

    // This code would put the reference point inside the polygon.
    for (let i = 0; i < this.m_count; ++i) {
      matrix.plusVec2(s, this.m_vertices[i]);
    }
    matrix.scaleVec2(s, 1.0 / this.m_count, s);

    const k_inv3 = 1.0 / 3.0;

    for (let i = 0; i < this.m_count; ++i) {
      // Triangle vertices.
      matrix.subVec2(e1, this.m_vertices[i], s);

      if (i + 1 < this.m_count) {
        matrix.subVec2(e2, this.m_vertices[i + 1], s);
      } else {
        matrix.subVec2(e2, this.m_vertices[0], s);
      }

      const D = matrix.crossVec2Vec2(e1, e2);

      const triangleArea = 0.5 * D;

      area += triangleArea;

      // Area weighted centroid
      matrix.combine2Vec2(
        temp,
        triangleArea * k_inv3,
        e1,
        triangleArea * k_inv3,
        e2,
      );
      matrix.plusVec2(center, temp);

      const ex1 = e1.x;
      const ey1 = e1.y;
      const ex2 = e2.x;
      const ey2 = e2.y;

      const intx2 = ex1 * ex1 + ex2 * ex1 + ex2 * ex2;
      const inty2 = ey1 * ey1 + ey2 * ey1 + ey2 * ey2;

      I += 0.25 * k_inv3 * D * (intx2 + inty2);
    }

    // Total mass
    massData.mass = density * area;

    // Center of mass
    if (_ASSERT) console.assert(area > EPSILON);
    matrix.scaleVec2(center, 1.0 / area, center);
    matrix.addVec2(massData.center, center, s);

    // Inertia tensor relative to the local origin (point s).
    massData.I = density * I;

    // Shift to center of mass then to original body origin.
    massData.I +=
      massData.mass *
      (matrix.dotVec2(massData.center, massData.center) -
        matrix.dotVec2(center, center));
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

/** @internal */ function computeCentroid(vs: Vec2[], count: number): Vec2 {
  if (_ASSERT) console.assert(count >= 3);

  const c = Vec2.zero();
  let area = 0.0;

  // pRef is the reference point for forming triangles.
  // It's location doesn't change the result (except for rounding error).
  const pRef = Vec2.zero();

  const inv3 = 1.0 / 3.0;

  for (let i = 0; i < count; ++i) {
    // Triangle vertices.
    const p1 = pRef;
    const p2 = vs[i];
    const p3 = i + 1 < count ? vs[i + 1] : vs[0];

    const e1 = Vec2.sub(p2, p1);
    const e2 = Vec2.sub(p3, p1);

    const D = Vec2.crossVec2Vec2(e1, e2);

    const triangleArea = 0.5 * D;

    area += triangleArea;

    // Area weighted centroid
    matrix.combine3Vec2(temp, 1, p1, 1, p2, 1, p3);
    matrix.plusScaleVec2(c, triangleArea * inv3, temp);
  }

  // Centroid
  if (_ASSERT) console.assert(area > EPSILON);
  c.mul(1.0 / area);
  return c;
}

export { PolygonShape as Polygon };
