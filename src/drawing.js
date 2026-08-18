import { createPolygon } from './polygon';

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

// Eight points around alternating radiuses makes a four pointed sparkle. The
// long ones go on the even corners, which are the ones straight up and along,
// so it comes out as a + rather than an x
export const sparklePath = (size) => shapePath(createPolygon({
  points: 8,
  radius: size * 0.7,
  radiusEven: size * 4,
}));

export const linesPath = (lines) => {
  const path = new Path2D();

  lines.forEach((points) => {
    points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  });

  return path;
};
