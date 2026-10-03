/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/Shape.ts
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

import { AABBValue } from '../axis-aligned-bounds';
import * as Vec from '../../utilities/vector';
import { TransformValue } from '../../utilities/vector-math';

/**
 * A shape is used for collision detection. You can create a shape however you
 * like. Shapes used for simulation in World are created automatically when a
 * Fixture is created.
 */
export abstract class Shape {
  // Local circle around the core vertices, excluding m_radius.
  protected m_bound?: { x: number; y: number; radius: number };
  declare m_count: number;
  /**
   * Radius of a shape. For polygonal shapes this must be b2_polygonRadius.
   * There is no support for making rounded polygons.
   */
  m_radius: number;
  declare m_type: ShapeType;
  declare m_vertices: Vec.Value[];

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   */
  abstract computeAABB(aabb: AABBValue, xf: TransformValue): void;

  getBound() {
    if (!this.m_bound) {
      const vertices = this.m_vertices;
      let x = 0;
      let y = 0;

      for (let i = 0; i < this.m_count; ++i) {
        x += vertices[i].x;
        y += vertices[i].y;
      }
      x /= this.m_count;
      y /= this.m_count;
      let radius = 0;

      for (let i = 0; i < this.m_count; ++i) {
        radius = Math.max(
          radius,
          Math.hypot(vertices[i].x - x, vertices[i].y - y),
        );
      }
      this.m_bound = { x, y, radius };
    }
    return this.m_bound;
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

  /**
   * Get a vertex by index for the distance query.
   */
  getVertex(index: number): Vec.Value {
    return this.m_vertices[index];
  }
}

export type ShapeType = 'circle' | 'polygon';
