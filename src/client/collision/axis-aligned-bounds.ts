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

import * as Vec from '../utilities/vector';

// Axis-aligned bounding box
export interface AABBValue {
  lowerBound: Vec.Value;
  upperBound: Vec.Value;
}

// Axis-aligned bounding box
export class AABB {
  lowerBound: Vec.Value;
  upperBound: Vec.Value;

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

    Vec.setXY(this.lowerBound, lowerX, lowerY);
    Vec.setXY(this.upperBound, upperX, upperY);
  }

  static combinedPerimeter(a: AABBValue, b: AABBValue) {
    const lx = Math.min(a.lowerBound.x, b.lowerBound.x);
    const ly = Math.min(a.lowerBound.y, b.lowerBound.y);
    const ux = Math.max(a.upperBound.x, b.upperBound.x);
    const uy = Math.max(a.upperBound.y, b.upperBound.y);

    return 2 * (ux - lx + uy - ly);
  }

  constructor() {
    this.lowerBound = Vec.create();
    this.upperBound = Vec.create();
  }

  contains(aabb: AABBValue): boolean {
    return (
      this.lowerBound.x <= aabb.lowerBound.x &&
      this.lowerBound.y <= aabb.lowerBound.y &&
      aabb.upperBound.x <= this.upperBound.x &&
      aabb.upperBound.y <= this.upperBound.y
    );
  }

  static extend(out: AABBValue, value: number): AABBValue {
    out.lowerBound.x -= value;
    out.lowerBound.y -= value;
    out.upperBound.x += value;
    out.upperBound.y += value;
    return out;
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

  set(aabb: AABBValue): void {
    Vec.setXY(this.lowerBound, aabb.lowerBound.x, aabb.lowerBound.y);
    Vec.setXY(this.upperBound, aabb.upperBound.x, aabb.upperBound.y);
  }

  static testOverlap(a: AABBValue, b: AABBValue): boolean {
    return !(
      b.lowerBound.x > a.upperBound.x ||
      b.lowerBound.y > a.upperBound.y ||
      a.lowerBound.x > b.upperBound.x ||
      a.lowerBound.y > b.upperBound.y
    );
  }
}
