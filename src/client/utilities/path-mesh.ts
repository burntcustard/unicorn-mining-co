import { DrawingPath } from './drawing-path';

const strokes = new WeakMap<
  DrawingPath,
  Map<string, { revision: number; path: DrawingPath }>
>();

function triangulate(points: number[][]) {
  const list = points.map((_, i) => i);

  if (
    points.length > 2 &&
    Math.hypot(
      points[0][0] - points.at(-1)![0],
      points[0][1] - points.at(-1)![1],
    ) < 1e-7
  ) {
    list.pop();
  }

  const area = list.reduce((sum, i, at) => {
    const next = points[list[(at + 1) % list.length]];

    return sum + points[i][0] * next[1] - points[i][1] * next[0];
  }, 0);

  if (area < 0) list.reverse();
  const output: number[] = [];
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  while (list.length > 3) {
    let found = false;

    for (let at = 0; at < list.length; at++) {
      const a = list[(at + list.length - 1) % list.length],
        b = list[at],
        c = list[(at + 1) % list.length];

      if (cross(points[a], points[b], points[c]) <= 1e-9) continue;

      if (
        list.some(
          (i) =>
            i !== a &&
            i !== b &&
            i !== c &&
            cross(points[a], points[b], points[i]) >= -1e-9 &&
            cross(points[b], points[c], points[i]) >= -1e-9 &&
            cross(points[c], points[a], points[i]) >= -1e-9,
        )
      ) {
        continue;
      }

      output.push(...points[a], ...points[b], ...points[c]);
      list.splice(at, 1);
      found = true;
      break;
    }

    if (!found) return undefined;
  }

  if (list.length === 3) {
    output.push(...points[list[0]], ...points[list[1]], ...points[list[2]]);
  }

  return new Float32Array(output);
}

const meshes = new WeakMap<
  DrawingPath,
  {
    revision: number;
    vertices: Float32Array;
    bounds: number[];
    triangles?: Float32Array;
  }
>();

export function mesh(path: DrawingPath) {
  let cached = meshes.get(path);

  if (cached?.revision === path.revision) return cached;
  const vertices: number[] = [];
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;

  for (const { points } of path.contours) {
    for (const [x, y] of points) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }

    for (let i = 1; i + 1 < points.length; i++) {
      vertices.push(...points[0], ...points[i], ...points[i + 1]);
    }
  }

  cached = {
    revision: path.revision,
    vertices: new Float32Array(vertices),
    bounds: [left, top, right, bottom],
    triangles:
      path.contours.length === 1
        ? triangulate(path.contours[0].points)
        : undefined,
  };

  meshes.set(path, cached);
  return cached;
}

export function strokePath(
  path: DrawingPath,
  width: number,
  dash: number[],
  cap: string,
  join: string,
) {
  let entries = strokes.get(path);

  if (!entries) strokes.set(path, (entries = new Map()));
  const key = JSON.stringify([width, dash, cap, join]),
    cached = entries.get(key);

  if (cached?.revision === path.revision) return cached.path;
  const result = new DrawingPath(false);
  const half = width / 2;

  const quad = (a: number[], b: number[]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);

    if (!length) return;
    const x = (-dy / length) * half,
      y = (dx / length) * half;

    result.moveTo(a[0] + x, a[1] + y);
    result.lineTo(b[0] + x, b[1] + y);
    result.lineTo(b[0] - x, b[1] - y);
    result.lineTo(a[0] - x, a[1] - y);
    result.closePath();
  };

  for (const contour of path.contours) {
    const p = contour.points;
    let index = 0,
      remaining = dash[0] || Infinity;

    for (let i = 0; i < p.length - (contour.closed ? 0 : 1); i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);

      if (!length) continue;

      if (!dash.length) {
        quad(a, b);
        continue;
      }

      let at = 0;

      while (at < length) {
        const end = Math.min(length, at + remaining);

        if (index % 2 === 0) {
          quad(
            [
              a[0] + ((b[0] - a[0]) * at) / length,
              a[1] + ((b[1] - a[1]) * at) / length,
            ],
            [
              a[0] + ((b[0] - a[0]) * end) / length,
              a[1] + ((b[1] - a[1]) * end) / length,
            ],
          );
        }

        remaining -= end - at;
        at = end;

        if (remaining < 1e-8) {
          index = (index + 1) % dash.length;
          remaining = dash[index];
        }
      }
    }

    if (!dash.length) {
      for (let i = 0; i < p.length; i++) {
        if (
          !contour.closed &&
          (i === 0 || i === p.length - 1) &&
          cap !== 'round'
        ) {
          continue;
        }

        if (join === 'round' || cap === 'round') {
          result.moveTo(p[i][0] + half, p[i][1]);
          result.arc(p[i][0], p[i][1], half, 0, Math.PI * 2);
          result.closePath();
        } else if (contour.closed || (i > 0 && i < p.length - 1)) {
          const before = p[(i + p.length - 1) % p.length],
            at = p[i],
            after = p[(i + 1) % p.length];
          const u = [at[0] - before[0], at[1] - before[1]],
            v = [after[0] - at[0], after[1] - at[1]],
            ul = Math.hypot(...u),
            vl = Math.hypot(...v);

          if (ul && vl) {
            for (const sense of [-1, 1]) {
              result.moveTo(...(at as [number, number]));
              result.lineTo(
                at[0] - (u[1] / ul) * half * sense,
                at[1] + (u[0] / ul) * half * sense,
              );
              result.lineTo(
                at[0] - (v[1] / vl) * half * sense,
                at[1] + (v[0] / vl) * half * sense,
              );
              result.closePath();
            }
          }
        }
      }
    }
  }

  for (const contour of result.contours) {
    const area = contour.points.reduce((sum, [x, y], i) => {
      const next = contour.points[(i + 1) % contour.points.length];

      return sum + x * next[1] - y * next[0];
    }, 0);

    if (area < 0) contour.points.reverse();
  }

  entries.set(key, { revision: path.revision, path: result });
  return result;
}
