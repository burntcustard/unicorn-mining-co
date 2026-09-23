/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/shape/CircleShape.ts
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

import { Vec2, Vec2Value } from '../../common/physics-vector';
import { Shape } from '../collision-shape';
import { AABBValue } from '../axis-aligned-bounds';
import { TransformValue } from '../../common/physics-transform';
import { MassData } from '../../dynamics/physics-body';
import { DistanceProxy } from '../shape-distance';

/** @internal */ const math_PI = Math.PI;

/** @internal */ const temp = matrix.vec2(0, 0);

/** Circle shape. */
export class CircleShape extends Shape {
  static TYPE = 'circle' as const;
  /** @hidden */ declare m_type: 'circle';

  /** @hidden */ m_p: Vec2;
  /** @hidden */ declare m_radius: number;

  constructor(position: Vec2Value, radius?: number);
  constructor(radius?: number);
  constructor(a: any, b?: any) {
    super();

    this.m_type = CircleShape.TYPE;
    this.m_p = Vec2.zero();
    this.m_radius = 1;

    if (typeof a === 'object' && Vec2.isValid(a)) {
      this.m_p.setVec2(a);

      if (typeof b === 'number') {
        this.m_radius = b;
      }
    } else if (typeof a === 'number') {
      this.m_radius = a;
    }
  }

  getType(): 'circle' {
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
   * Given a transform, compute the associated axis aligned bounding box for a
   * child shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   * @param childIndex The child shape
   */
  computeAABB(aabb: AABBValue, xf: TransformValue, _childIndex: number): void {
    const p = matrix.transformVec2(temp, xf, this.m_p);

    matrix.setVec2(aabb.lowerBound, p.x - this.m_radius, p.y - this.m_radius);
    matrix.setVec2(aabb.upperBound, p.x + this.m_radius, p.y + this.m_radius);
  }

  /**
   * Compute the mass properties of this shape using its dimensions and density.
   * The inertia tensor is computed about the local origin.
   *
   * @param massData Returns the mass data for this shape.
   * @param density The density in kilograms per meter squared.
   */
  computeMass(massData: MassData, density: number): void {
    massData.mass = density * math_PI * this.m_radius * this.m_radius;
    matrix.copyVec2(massData.center, this.m_p);
    // inertia about the local origin
    massData.I =
      massData.mass *
      (0.5 * this.m_radius * this.m_radius + matrix.lengthSqrVec2(this.m_p));
  }

  computeDistanceProxy(proxy: DistanceProxy): void {
    proxy.m_vertices[0] = this.m_p;
    proxy.m_vertices.length = 1;
    proxy.m_count = 1;
    proxy.m_radius = this.m_radius;
  }
}

export { CircleShape as Circle };
