/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/common/Matrix.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/*
 * Planck.js
 *
 * Copyright (c) Ali Shakiba
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as Vec from './vector';

export type RotValue = {
  s: number;
  c: number;
};

export type TransformValue = {
  p: Vec.Value;
  q: RotValue;
};

export function setRotAngle(out: RotValue, a: number): RotValue {
  out.c = Math.cos(a);
  out.s = Math.sin(a);
  return out;
}

export function rotateInto(
  out: Vec.Value,
  q: RotValue,
  v: Vec.Value,
): Vec.Value {
  const x = q.c * v.x - q.s * v.y;
  const y = q.s * v.x + q.c * v.y;

  out.x = x;
  out.y = y;
  return out;
}

export function unrotateInto(
  out: Vec.Value,
  q: RotValue,
  v: Vec.Value,
): Vec.Value {
  const x = q.c * v.x + q.s * v.y;
  const y = -q.s * v.x + q.c * v.y;

  out.x = x;
  out.y = y;
  return out;
}

export function rerotateInto(
  out: Vec.Value,
  before: RotValue,
  after: RotValue,
  v: Vec.Value,
): Vec.Value {
  const x0 = before.c * v.x + before.s * v.y;
  const y0 = -before.s * v.x + before.c * v.y;
  const x = after.c * x0 - after.s * y0;
  const y = after.s * x0 + after.c * y0;

  out.x = x;
  out.y = y;
  return out;
}

export function transform(x: number, y: number, a: number): TransformValue {
  return { p: Vec.create(x, y), q: { s: Math.sin(a), c: Math.cos(a) } };
}

export function transformInto(
  out: Vec.Value,
  xf: TransformValue,
  v: Vec.Value,
): Vec.Value {
  const x = xf.q.c * v.x - xf.q.s * v.y + xf.p.x;
  const y = xf.q.s * v.x + xf.q.c * v.y + xf.p.y;

  out.x = x;
  out.y = y;
  return out;
}

export function inverseTransformInto(
  out: Vec.Value,
  xf: TransformValue,
  v: Vec.Value,
): Vec.Value {
  const px = v.x - xf.p.x;
  const py = v.y - xf.p.y;
  const x = xf.q.c * px + xf.q.s * py;
  const y = -xf.q.s * px + xf.q.c * py;

  out.x = x;
  out.y = y;
  return out;
}

export function changeTransformInto(
  out: Vec.Value,
  from: TransformValue,
  to: TransformValue,
  v: Vec.Value,
): Vec.Value {
  const x0 = from.q.c * v.x - from.q.s * v.y + from.p.x;
  const y0 = from.q.s * v.x + from.q.c * v.y + from.p.y;
  const px = x0 - to.p.x;
  const py = y0 - to.p.y;
  const x = to.q.c * px + to.q.s * py;
  const y = -to.q.s * px + to.q.c * py;

  out.x = x;
  out.y = y;
  return out;
}

export function detransformTransform(
  out: TransformValue,
  a: TransformValue,
  b: TransformValue,
): TransformValue {
  const c = a.q.c * b.q.c + a.q.s * b.q.s;
  const s = a.q.c * b.q.s - a.q.s * b.q.c;
  const x = a.q.c * (b.p.x - a.p.x) + a.q.s * (b.p.y - a.p.y);
  const y = -a.q.s * (b.p.x - a.p.x) + a.q.c * (b.p.y - a.p.y);

  out.q.c = c;
  out.q.s = s;
  out.p.x = x;
  out.p.y = y;
  return out;
}

export function setTransform(
  out: TransformValue,
  position: Vec.Value,
  rotation: number,
): TransformValue {
  Vec.set(out.p, position);
  setRotAngle(out.q, rotation);
  return out;
}
