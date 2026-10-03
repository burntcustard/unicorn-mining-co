import * as Vec from './vector';
import { sinCos } from './sin-cos';

export type RotValue = {
  sin: number;
  cos: number;
};

export type TransformValue = {
  p: Vec.Value;
  q: RotValue;
};

export function rotateInto(
  out: Vec.Value,
  q: RotValue,
  v: Vec.Value,
): Vec.Value {
  const x = q.cos * v.x - q.sin * v.y;
  const y = q.sin * v.x + q.cos * v.y;

  out.x = x;
  out.y = y;
  return out;
}

export function unrotateInto(
  out: Vec.Value,
  q: RotValue,
  v: Vec.Value,
): Vec.Value {
  const x = q.cos * v.x + q.sin * v.y;
  const y = -q.sin * v.x + q.cos * v.y;

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
  const x0 = before.cos * v.x + before.sin * v.y;
  const y0 = -before.sin * v.x + before.cos * v.y;
  const x = after.cos * x0 - after.sin * y0;
  const y = after.sin * x0 + after.cos * y0;

  out.x = x;
  out.y = y;
  return out;
}

export function transform(x: number, y: number, a: number): TransformValue {
  return { p: Vec.create(x, y), q: sinCos({ sin: 0, cos: 1 }, a) };
}

export function transformInto(
  out: Vec.Value,
  xf: TransformValue,
  v: Vec.Value,
): Vec.Value {
  const x = xf.q.cos * v.x - xf.q.sin * v.y + xf.p.x;
  const y = xf.q.sin * v.x + xf.q.cos * v.y + xf.p.y;

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
  const x = xf.q.cos * px + xf.q.sin * py;
  const y = -xf.q.sin * px + xf.q.cos * py;

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
  const x0 = from.q.cos * v.x - from.q.sin * v.y + from.p.x;
  const y0 = from.q.sin * v.x + from.q.cos * v.y + from.p.y;
  const px = x0 - to.p.x;
  const py = y0 - to.p.y;
  const x = to.q.cos * px + to.q.sin * py;
  const y = -to.q.sin * px + to.q.cos * py;

  out.x = x;
  out.y = y;
  return out;
}

export function detransformTransform(
  out: TransformValue,
  a: TransformValue,
  b: TransformValue,
): TransformValue {
  const cos = a.q.cos * b.q.cos + a.q.sin * b.q.sin;
  const sin = a.q.cos * b.q.sin - a.q.sin * b.q.cos;
  const x = a.q.cos * (b.p.x - a.p.x) + a.q.sin * (b.p.y - a.p.y);
  const y = -a.q.sin * (b.p.x - a.p.x) + a.q.cos * (b.p.y - a.p.y);

  out.q.cos = cos;
  out.q.sin = sin;
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
  sinCos(out.q, rotation);
  return out;
}
