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

import * as matrix from '../../vector-math';

import * as Vec from '../../vector';
import { Shape } from './base';
import { AABBValue } from '../axis-aligned-bounds';
import { TransformValue } from '../../vector-math';

const temp = Vec.create();

// Circle shape.
export class CircleShape extends Shape {
  declare m_type: 'circle';
  m_count = 1;

  get m_p() {
    return this.m_vertices[0];
  }
  set m_p(point: Vec.Value) {
    this.m_vertices[0] = point;
    this.m_bound = undefined;
  }
  static TYPE = 'circle' as const;

  declare m_radius: number;

  constructor(position: Vec.Value, radius: number) {
    super();
    this.m_type = CircleShape.TYPE;
    this.m_vertices = [Vec.clone(position)];
    this.m_radius = radius;
  }

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   */
  computeAABB(aabb: AABBValue, xf: TransformValue): void {
    const p = matrix.transformInto(temp, xf, this.m_p);

    Vec.setXY(aabb.lowerBound, p.x - this.m_radius, p.y - this.m_radius);
    Vec.setXY(aabb.upperBound, p.x + this.m_radius, p.y + this.m_radius);
  }
}

export { CircleShape as Circle };
