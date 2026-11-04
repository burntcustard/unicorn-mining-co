/*
 * Curve endpoints carry incoming quadratic (four values) or cubic (six values)
 * controls. Plain pairs remain straight vertices.
 */
export const sampleCurve = (from: number[], to: number[], count = 8) =>
  Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    const u = 1 - t;

    return [0, 1].map((axis) =>
      to.length === 6
        ? u ** 3 * from[axis] +
          3 * u ** 2 * t * to[axis + 2] +
          3 * u * t ** 2 * to[axis + 4] +
          t ** 3 * to[axis]
        : u ** 2 * from[axis] + 2 * u * t * to[axis + 2] + t ** 2 * to[axis],
    );
  });

export const sampleOutline = (points: number[][]) =>
  points.flatMap((point, index) =>
    index && point.length > 2
      ? sampleCurve(points[index - 1], point)
      : [point.slice(0, 2)],
  );
