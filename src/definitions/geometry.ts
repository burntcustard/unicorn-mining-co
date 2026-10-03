export const createPolygon = ({
  pointCount,
  radius,
}: {
  pointCount: number;
  radius: number;
}) =>
  Array.from({ length: pointCount }, (_, i) => {
    const angle = (i / pointCount) * Math.PI * 2;

    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
export const rotatePoints = (points: number[][], angle: number) =>
  points.map(([x, y]) => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ]);
