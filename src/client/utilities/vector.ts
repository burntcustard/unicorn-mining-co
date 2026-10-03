/* Vendored vector formulas from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/common/Vec2.ts
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
 * The game vector operations are based on Kontra vector.js, available under
 * the MIT licence: https://github.com/straker/kontra/blob/main/src/vector.js
 */

export type Value = { x: number; y: number };

export const create = (x = 0, y = 0): Value => ({ x, y });

export function set(out: Value, value: Value): Value {
  out.x = value.x;
  out.y = value.y;
  return out;
}

export function setXY(out: Value, x: number, y: number): Value {
  out.x = x;
  out.y = y;
  return out;
}

export function clone(value: Value): Value {
  return create(value.x, value.y);
}

/**
 * Arithmetic creates a vector unless an output vector is supplied.
 * The output can also be one of the inputs.
 */
export function add(a: Value, b: Value, out = create()): Value {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function addScaled(
  point: Value,
  direction: Value,
  distance: number,
  out = create(),
): Value {
  out.x = point.x + direction.x * distance;
  out.y = point.y + direction.y * distance;
  return out;
}

export function subtract(a: Value, b: Value, out = create()): Value {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale(value: Value, amount: number, out = create()): Value {
  out.x = value.x * amount;
  out.y = value.y * amount;
  return out;
}

export function length(value: Value): number {
  return Math.sqrt(value.x * value.x + value.y * value.y);
}

export function distance(a: Value, b: Value): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(value: Value, out = create()): Value {
  const magnitude = length(value) || 1;

  out.x = value.x / magnitude;
  out.y = value.y / magnitude;
  return out;
}

export function combine2Into(
  out: Value,
  am: number,
  a: Value,
  bm: number,
  b: Value,
): Value {
  out.x = am * a.x + bm * b.x;
  out.y = am * a.y + bm * b.y;
  return out;
}

export function combine3Into(
  out: Value,
  am: number,
  a: Value,
  bm: number,
  b: Value,
  cm: number,
  c: Value,
): Value {
  out.x = am * a.x + bm * b.x + cm * c.x;
  out.y = am * a.y + bm * b.y + cm * c.y;
  return out;
}

export function crossScalarInto(out: Value, v: Value, w: number): Value {
  const x = w * v.y;
  const y = -w * v.x;

  out.x = x;
  out.y = y;
  return out;
}

export function cross(a: Value, b: Value): number {
  return a.x * b.y - a.y * b.x;
}

export function dot(a: Value, b: Value): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSquared(a: Value): number {
  return a.x * a.x + a.y * a.y;
}

export function distanceSquared(a: Value, b: Value): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
}
