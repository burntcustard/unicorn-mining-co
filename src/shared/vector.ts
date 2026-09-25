/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/common/Vec2.ts
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
/*
 * The game Vector API is based on Kontra vector.js, available under the MIT
 * licence: https://github.com/straker/kontra/blob/main/src/vector.js
 */

import { dotVec2 } from './common/physics-matrix';

export interface Vec2Value {
  x: number;
  y: number;
}

/**
 * Shared game and solver vector. Game arithmetic returns new vectors; the
 * solver's explicit in-place methods and out-parameter helpers avoid hot
 * allocations.
 */
export class Vec2 implements Vec2Value {
  constructor(
    public x: number,
    public y: number,
  ) {}

  static zero() {
    return Vec2.neo(0, 0);
  }

  static neo(x: number, y: number) {
    const result = Object.create(Vec2.prototype) as Vec2;

    result.x = x;
    result.y = y;
    return result;
  }

  static clone(value: Vec2Value) {
    return Vec2.neo(value.x, value.y);
  }

  set(value: Vec2Value): this;
  set(x: number, y: number): this;
  set(value: Vec2Value | number, y?: number): this {
    if (typeof value === 'number') {
      this.x = value;
      this.y = y!;
    } else {
      this.x = value.x;
      this.y = value.y;
    }
    return this;
  }

  setZero(): this {
    this.x = 0;
    this.y = 0;
    return this;
  }

  setNum(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setVec2(value: Vec2Value): this {
    this.x = value.x;
    this.y = value.y;
    return this;
  }

  add(value: Vec2Value) {
    return new Vec2(this.x + value.x, this.y + value.y);
  }

  subtract(value: Vec2Value) {
    return new Vec2(this.x - value.x, this.y - value.y);
  }

  scale(value: number) {
    return new Vec2(this.x * value, this.y * value);
  }

  dot(value: Vec2Value) {
    return dotVec2(this, value);
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  distanceTo(value: Vec2Value) {
    return Math.hypot(this.x - value.x, this.y - value.y);
  }

  normalize(length = this.length() || 1) {
    return new Vec2(this.x / length, this.y / length);
  }

  normalizeSelf() {
    const length = this.length();

    if (length < 1e-9) return 0;
    this.x /= length;
    this.y /= length;
    return length;
  }

  mul(value: number): this {
    this.x *= value;
    this.y *= value;
    return this;
  }

  static crossVec2Num(value: Vec2Value, amount: number) {
    return Vec2.neo(amount * value.y, -amount * value.x);
  }

  static crossNumVec2(amount: number, value: Vec2Value) {
    return Vec2.neo(-amount * value.y, amount * value.x);
  }

  static add(a: Vec2Value, b: Vec2Value) {
    return Vec2.neo(a.x + b.x, a.y + b.y);
  }

  static sub(a: Vec2Value, b: Vec2Value) {
    return Vec2.neo(a.x - b.x, a.y - b.y);
  }
}

export const Vector = (x = 0, y = 0) => new Vec2(x, y);

export type Vector = ReturnType<typeof Vector>;
