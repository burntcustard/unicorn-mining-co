import { createPath } from './drawing-path';
import { createPolygon } from './polygon';
import { type Segment } from '../types';

// Stroke width in game units, shared by every drawn object's shape outline
export const objectLineWidth = 3;

// Stroke width in game units. Finer than a ship's, because an item is a small
// thing and a heavy shape outline swallows it
export const itemLineWidth = 2;

const circles = new Map<number, Path2D>();

export const circlePath = (radius: number) => {
  const cached = circles.get(radius);

  if (cached) return cached;
  const path = createPath();

  path.arc(0, 0, radius, 0, Math.PI * 2);

  if (circles.size === 128) circles.delete(circles.keys().next().value);
  circles.set(radius, path);

  return path;
};

const paths = new WeakMap<number[][], Path2D[]>();

export const shapePath = (points: number[][], unclosed = false) => {
  const index = +unclosed;
  const cached = paths.get(points)?.[index];

  if (cached) return cached;
  const path = createPath();

  points.forEach(([x, y]) => path.lineTo(x, y));
  unclosed || path.closePath();

  if (Object.isFrozen(points)) {
    const entries = paths.get(points) || [];

    entries[index] = path;
    paths.set(points, entries);
  }

  return path;
};

// Eight points around alternating radiuses makes a four pointed sparkle. The
// long ones go on the even corners, which are the ones straight up and along,
// so it comes out as a + rather than an x
const sparkles = new Map<string, Path2D>();

export const sparklePath = (size: number, width = 0.7) => {
  const key = `${size}/${width}`;
  const cached = sparkles.get(key);

  if (cached) return cached;

  const path = shapePath(
    createPolygon({
      pointCount: 8,
      radius: size * width,
      radiusEven: size * 4,
    }),
  );

  if (sparkles.size === 32) sparkles.delete(sparkles.keys().next().value);
  sparkles.set(key, path);
  return path;
};

const linePaths = new WeakMap<number[][][], Path2D>();

export const linesPath = (lines: number[][][]) => {
  const cached = linePaths.get(lines);

  if (cached) return cached;
  const path = createPath();

  lines.forEach((points) => {
    points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  });

  if (Object.isFrozen(lines)) linePaths.set(lines, path);

  return path;
};

/*
 * Draw segment geometry using the caller's fill and stroke styles.
 */
export const drawSegment = ({
  ctx,
  segment,
}: {
  ctx: CanvasRenderingContext2D;
  segment: Segment;
}) => {
  const points =
    typeof segment.points === 'function'
      ? segment.points(segment)
      : segment.points;
  const path = points?.length
    ? shapePath(points, segment.unclosed)
    : segment.radius
      ? circlePath(segment.radius(segment))
      : undefined;

  if (path) {
    ctx.fill(path);
    ctx.stroke(segment.shapeOutline ? linesPath(segment.shapeOutline) : path);
  }

  if (segment.lines) {
    ctx.save();

    if (segment.lines.call) ctx.clip(path);
    ctx.stroke(
      linesPath(segment.lines.call ? segment.lines(segment) : segment.lines),
    );
    ctx.restore();
  }
};

// A sheet with one edge running out along one line of points and back along
// another
export const strip = (near: any[], far = near) => {
  const path = createPath();

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
