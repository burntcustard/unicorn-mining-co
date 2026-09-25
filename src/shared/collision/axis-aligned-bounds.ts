/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/AABB.ts
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

import { Vec2, Vec2Value } from '../vector';

/** Axis-aligned bounding box */
export interface AABBValue {
  lowerBound: Vec2Value;
  upperBound: Vec2Value;
}

/** Axis-aligned bounding box */
export class AABB {
  lowerBound: Vec2;
  upperBound: Vec2;

  constructor() {
    this.lowerBound = Vec2.zero();
    this.upperBound = Vec2.zero();
  }

  /**
   * Get the perimeter length.
   */
  getPerimeter(): number {
    return (
      2 *
      (this.upperBound.x -
        this.lowerBound.x +
        this.upperBound.y -
        this.lowerBound.y)
    );
  }

  /**
   * Combine one or two AABB into this one.
   */
  combine(a: AABBValue, b: AABBValue): void {
    const lowerA = a.lowerBound;
    const upperA = a.upperBound;
    const lowerB = b.lowerBound;
    const upperB = b.upperBound;

    const lowerX = Math.min(lowerA.x, lowerB.x);
    const lowerY = Math.min(lowerA.y, lowerB.y);
    const upperX = Math.max(upperB.x, upperA.x);
    const upperY = Math.max(upperB.y, upperA.y);

    this.lowerBound.setNum(lowerX, lowerY);
    this.upperBound.setNum(upperX, upperY);
  }

  set(aabb: AABBValue): void {
    this.lowerBound.setNum(aabb.lowerBound.x, aabb.lowerBound.y);
    this.upperBound.setNum(aabb.upperBound.x, aabb.upperBound.y);
  }

  contains(aabb: AABBValue): boolean {
    let result = true;

    result = result && this.lowerBound.x <= aabb.lowerBound.x;
    result = result && this.lowerBound.y <= aabb.lowerBound.y;
    result = result && aabb.upperBound.x <= this.upperBound.x;
    result = result && aabb.upperBound.y <= this.upperBound.y;
    return result;
  }

  static extend(out: AABBValue, value: number): AABBValue {
    out.lowerBound.x -= value;
    out.lowerBound.y -= value;
    out.upperBound.x += value;
    out.upperBound.y += value;
    return out;
  }

  static testOverlap(a: AABBValue, b: AABBValue): boolean {
    const d1x = b.lowerBound.x - a.upperBound.x;
    const d2x = a.lowerBound.x - b.upperBound.x;

    const d1y = b.lowerBound.y - a.upperBound.y;
    const d2y = a.lowerBound.y - b.upperBound.y;

    if (d1x > 0 || d1y > 0 || d2x > 0 || d2y > 0) {
      return false;
    }
    return true;
  }

  static combinedPerimeter(a: AABBValue, b: AABBValue) {
    const lx = Math.min(a.lowerBound.x, b.lowerBound.x);
    const ly = Math.min(a.lowerBound.y, b.lowerBound.y);
    const ux = Math.max(a.upperBound.x, b.upperBound.x);
    const uy = Math.max(a.upperBound.y, b.upperBound.y);

    return 2 * (ux - lx + uy - ly);
  }
}
