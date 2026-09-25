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

import { AABBValue } from './axis-aligned-bounds';
import { DistanceProxy } from './shape-distance';
import { TransformValue } from '../common/physics-transform';

/**
 * A shape is used for collision detection. You can create a shape however you
 * like. Shapes used for simulation in World are created automatically when a
 * Fixture is created.
 */
export abstract class Shape {
  declare m_type: ShapeType;

  /**
   * Radius of a shape. For polygonal shapes this must be b2_polygonRadius.
   * There is no support for making rounded polygons.
   */
  m_radius: number;

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   */
  abstract computeAABB(aabb: AABBValue, xf: TransformValue): void;

  abstract computeDistanceProxy(proxy: DistanceProxy): void;
}

export type ShapeType = 'circle' | 'polygon';
