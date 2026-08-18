export const circlePath = (radius) => {
  const path = new Path2D();

  path.arc(0, 0, radius, 0, Math.PI * 2);

  return path;
};

export const shapePath = (points) => {
  const path = new Path2D();

  points.forEach(([x, y]) => path.lineTo(x, y));
  path.closePath();

  return path;
};

export const linesPath = (lines) => {
  const path = new Path2D();

  lines.forEach((points) => {
    points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  });

  return path;
};
