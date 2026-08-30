import { createPolygon } from './polygon';

// Stroke width in game units, shared by every drawn object's outline
export const objectLineWidth = 3;

// Stroke width in game units. Finer than a ship's, because an item is a small
// thing and a heavy outline swallows it
export const itemLineWidth = 2;

export const circlePath = (radius) => {
  const path = new Path2D();

  path.arc(0, 0, radius, 0, Math.PI * 2);

  return path;
};

export const shapePath = (points, unclosed) => {
  const path = new Path2D();

  points.forEach(([x, y]) => path.lineTo(x, y));
  if (!unclosed) path.closePath();

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

// A sheet with one edge running out along one line of points and back along
// another
export const strip = (near, far = near) => {
  const path = new Path2D();

  near.forEach((point, i) => {
    const { x, y } = point.at || point;

    i ? path.lineTo(x, y) : path.moveTo(x, y);
  });

  for (let i = far.length; i--;) {
    const { x, y } = far[i].out?.at || far[i];

    path.lineTo(x, y);
  }

  path.closePath();

  return path;
};
