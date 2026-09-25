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

import { Vec2, type Vec2Value } from './vector';

export {
  crossVec2Vec2,
  dotVec2,
  lengthSqrVec2,
  distVec2,
  distSqrVec2,
} from './vector';

export type RotValue = {
  s: number;
  c: number;
};

export type TransformValue = {
  p: Vec2Value;
  q: RotValue;
};

// Solver scratch values use plain objects and explicit output parameters.
export function vec2(x: number, y: number): Vec2Value {
  return { x, y };
}

export function setVec2(out: Vec2Value, x: number, y: number): Vec2Value {
  out.x = x;
  out.y = y;
  return out;
}

export function copyVec2(out: Vec2Value, w: Vec2Value): Vec2Value {
  out.x = w.x;
  out.y = w.y;
  return out;
}

export function zeroVec2(out: Vec2Value): Vec2Value {
  out.x = 0;
  out.y = 0;
  return out;
}

export function negVec2(out: Vec2Value): Vec2Value {
  out.x = -out.x;
  out.y = -out.y;
  return out;
}

export function plusVec2(out: Vec2Value, w: Vec2Value): Vec2Value {
  out.x += w.x;
  out.y += w.y;
  return out;
}

export function minusVec2(out: Vec2Value, w: Vec2Value): Vec2Value {
  out.x -= w.x;
  out.y -= w.y;
  return out;
}

export function subVec2(out: Vec2Value, v: Vec2Value, w: Vec2Value): Vec2Value {
  out.x = v.x - w.x;
  out.y = v.y - w.y;
  return out;
}

export function mulVec2(out: Vec2Value, m: number): Vec2Value {
  out.x *= m;
  out.y *= m;
  return out;
}

export function scaleVec2(out: Vec2Value, m: number, w: Vec2Value): Vec2Value {
  out.x = m * w.x;
  out.y = m * w.y;
  return out;
}

export function plusScaleVec2(
  out: Vec2Value,
  m: number,
  w: Vec2Value,
): Vec2Value {
  out.x += m * w.x;
  out.y += m * w.y;
  return out;
}

export function minusScaleVec2(
  out: Vec2Value,
  m: number,
  w: Vec2Value,
): Vec2Value {
  out.x -= m * w.x;
  out.y -= m * w.y;
  return out;
}

export function combine2Vec2(
  out: Vec2Value,
  am: number,
  a: Vec2Value,
  bm: number,
  b: Vec2Value,
): Vec2Value {
  out.x = am * a.x + bm * b.x;
  out.y = am * a.y + bm * b.y;
  return out;
}

export function combine3Vec2(
  out: Vec2Value,
  am: number,
  a: Vec2Value,
  bm: number,
  b: Vec2Value,
  cm: number,
  c: Vec2Value,
): Vec2Value {
  out.x = am * a.x + bm * b.x + cm * c.x;
  out.y = am * a.y + bm * b.y + cm * c.y;
  return out;
}

export function normalizeVec2Length(out: Vec2Value): number {
  const length = Math.sqrt(out.x * out.x + out.y * out.y);

  if (length !== 0) {
    const invLength = 1 / length;

    out.x *= invLength;
    out.y *= invLength;
  }
  return length;
}

export function normalizeVec2(out: Vec2Value): Vec2Value {
  const length = Math.sqrt(out.x * out.x + out.y * out.y);

  if (length > 0) {
    const invLength = 1 / length;

    out.x *= invLength;
    out.y *= invLength;
  }
  return out;
}

export function crossVec2Num(
  out: Vec2Value,
  v: Vec2Value,
  w: number,
): Vec2Value {
  const x = w * v.y;
  const y = -w * v.x;

  out.x = x;
  out.y = y;
  return out;
}

export function crossNumVec2(
  out: Vec2Value,
  w: number,
  v: Vec2Value,
): Vec2Value {
  const x = -w * v.y;
  const y = w * v.x;

  out.x = x;
  out.y = y;
  return out;
}

export function setRotAngle(out: RotValue, a: number): RotValue {
  out.c = Math.cos(a);
  out.s = Math.sin(a);
  return out;
}

export function rotVec2(out: Vec2Value, q: RotValue, v: Vec2Value): Vec2Value {
  out.x = q.c * v.x - q.s * v.y;
  out.y = q.s * v.x + q.c * v.y;
  return out;
}

export function derotVec2(
  out: Vec2Value,
  q: RotValue,
  v: Vec2Value,
): Vec2Value {
  const x = q.c * v.x + q.s * v.y;
  const y = -q.s * v.x + q.c * v.y;

  out.x = x;
  out.y = y;
  return out;
}

export function rerotVec2(
  out: Vec2Value,
  before: RotValue,
  after: RotValue,
  v: Vec2Value,
): Vec2Value {
  const x0 = before.c * v.x + before.s * v.y;
  const y0 = -before.s * v.x + before.c * v.y;
  const x = after.c * x0 - after.s * y0;
  const y = after.s * x0 + after.c * y0;

  out.x = x;
  out.y = y;
  return out;
}

export function transform(x: number, y: number, a: number): TransformValue {
  return { p: vec2(x, y), q: { s: Math.sin(a), c: Math.cos(a) } };
}

export function transformVec2(
  out: Vec2Value,
  xf: TransformValue,
  v: Vec2Value,
): Vec2Value {
  const x = xf.q.c * v.x - xf.q.s * v.y + xf.p.x;
  const y = xf.q.s * v.x + xf.q.c * v.y + xf.p.y;

  out.x = x;
  out.y = y;
  return out;
}

export function detransformVec2(
  out: Vec2Value,
  xf: TransformValue,
  v: Vec2Value,
): Vec2Value {
  const px = v.x - xf.p.x;
  const py = v.y - xf.p.y;
  const x = xf.q.c * px + xf.q.s * py;
  const y = -xf.q.s * px + xf.q.c * py;

  out.x = x;
  out.y = y;
  return out;
}

export function retransformVec2(
  out: Vec2Value,
  from: TransformValue,
  to: TransformValue,
  v: Vec2Value,
): Vec2Value {
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

// Position and rotation of a collider in the solver.
export class Transform implements TransformValue {
  p = Vec2.zero();
  q: RotValue = { s: 0, c: 1 };

  constructor(position?: Vec2Value, rotation?: number) {
    if (position) this.p.setVec2(position);

    if (rotation !== undefined) setRotAngle(this.q, rotation);
  }

  setNum(position: Vec2Value, rotation: number): void {
    this.p.setVec2(position);
    setRotAngle(this.q, rotation);
  }
}
