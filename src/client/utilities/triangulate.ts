export function triangulate(points: number[][]) {
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
            ![a, b, c].some(
              (corner) =>
                Math.hypot(
                  points[i][0] - points[corner][0],
                  points[i][1] - points[corner][1],
                ) < 1e-8,
            ) &&
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

/*
 * A concave outline needs several fixtures; convex outlines keep one fixture.
 */
export const convexParts = (points: number[][]) => {
  const turns = points.map((a, index) => {
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];

    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });

  if (
    !turns.some((turn) => turn < -1e-9) ||
    !turns.some((turn) => turn > 1e-9)
  ) {
    return undefined;
  }

  const triangles = triangulate(points);

  // Older module wreckage can contain repeated strokes rather than a simple
  // polygon. Preserve its existing convex fallback when it cannot be split.
  if (!triangles) return undefined;
  return Array.from({ length: triangles.length / 6 }, (_, index) =>
    Array.from({ length: 3 }, (_, vertex) => [
      triangles[index * 6 + vertex * 2],
      triangles[index * 6 + vertex * 2 + 1],
    ]),
  );
};
