import * as Vec from './vector';

/*
 * Interpolate both edges through shared joints. Neighboring cubic sections
 * have the same endpoint and tangent, including when the spine bends.
 */
export const ribbonSections = (points: Vec.Value[], widths: number[]) => {
  const tangents = points.map((point, index) =>
    Vec.scale(
      Vec.subtract(
        points[Math.min(index + 1, points.length - 1)],
        points[Math.max(0, index - 1)],
      ),
      0.5,
    ),
  );

  const edges = [-1, 1].map((side) =>
    points.map((point, index) => {
      const normal = Vec.normalize(
        Vec.create(-tangents[index].y, tangents[index].x),
      );

      return Vec.addScaled(point, normal, widths[index] * side);
    }),
  );

  const controls = edges.map((edge) =>
    edge.map((point, index) =>
      Vec.scale(
        Vec.subtract(
          edge[Math.min(index + 1, edge.length - 1)],
          edge[Math.max(0, index - 1)],
        ),
        1 / 6,
      ),
    ),
  );

  const curve = (edge: number, from: number, to: number) => {
    const direction = Math.sign(to - from);
    const first = Vec.addScaled(
      edges[edge][from],
      controls[edge][from],
      direction,
    );
    const last = Vec.addScaled(edges[edge][to], controls[edge][to], -direction);

    return [
      edges[edge][to].x,
      edges[edge][to].y,
      first.x,
      first.y,
      last.x,
      last.y,
    ];
  };

  return points.slice(1).map((_, index) => ({
    near: [edges[0][index].x, edges[0][index].y],
    forward: curve(0, index, index + 1),
    far: [edges[1][index + 1].x, edges[1][index + 1].y],
    backward: curve(1, index + 1, index),
  }));
};
