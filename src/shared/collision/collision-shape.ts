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

import type { MassData } from '../dynamics/physics-body';
import { AABBValue } from './axis-aligned-bounds';
import { DistanceProxy } from './shape-distance';
import { TransformValue } from '../common/physics-transform';

// todo make shape an interface

/**
 * A shape is used for collision detection. You can create a shape however you
 * like. Shapes used for simulation in World are created automatically when a
 * Fixture is created. Shapes may encapsulate one or more child shapes.
 */
export abstract class Shape {
  /** @hidden */ declare m_type: ShapeType;

  /**
   * @hidden
   * Radius of a shape. For polygonal shapes this must be b2_polygonRadius.
   * There is no support for making rounded polygons.
   */
  m_radius: number;

  static isValid(obj: any): boolean {
    if (obj === null || typeof obj === 'undefined') {
      return false;
    }
    return typeof obj.m_type === 'string' && typeof obj.m_radius === 'number';
  }

  abstract getRadius(): number;

  /**
   * Get the type of this shape. You can use this to down cast to the concrete
   * shape.
   *
   * @return the shape type.
   */
  abstract getType(): ShapeType;

  /**
   * Get the number of child primitives.
   */
  abstract getChildCount(): number;

  /**
   * Given a transform, compute the associated axis aligned bounding box for a
   * child shape.
   *
   * @param aabb Returns the axis aligned box.
   * @param xf The world transform of the shape.
   * @param childIndex The child shape
   */
  abstract computeAABB(
    aabb: AABBValue,
    xf: TransformValue,
    childIndex: number,
  ): void;

  /**
   * Compute the mass properties of this shape using its dimensions and density.
   * The inertia tensor is computed about the local origin.
   *
   * @param massData Returns the mass data for this shape.
   * @param density The density in kilograms per meter squared.
   */
  abstract computeMass(massData: MassData, density?: number): void;

  abstract computeDistanceProxy(proxy: DistanceProxy, childIndex: number): void;
}

export type ShapeType = 'circle' | 'edge' | 'polygon' | 'chain';
