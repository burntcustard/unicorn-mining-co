import assert from 'node:assert/strict';
import { DrawingPath } from '../../src/client/utilities/drawing-path';
import { strokePath } from '../../src/client/utilities/path-mesh';
import { drawSegment } from '../../src/client/utilities/drawing';
import type { Segment } from '../../src/client/types';

const corner = new DrawingPath(false);

corner.moveTo(0, 10);
corner.lineTo(0, 0);
corner.lineTo(10, 0);

const hasPoint = (path: DrawingPath, x: number, y: number) =>
  path.contours.some(({ points }) =>
    points.some(([px, py]) => Math.hypot(px - x, py - y) < 1e-8),
  );

const bevel = strokePath(corner, 2, [], 'butt', 'bevel');
const miter = strokePath(corner, 2, [], 'butt', 'miter');
const round = strokePath(corner, 2, [], 'butt', 'round');

assert(
  hasPoint(miter, -1, -1),
  'miter joins reach the offset edge intersection',
);
assert(!hasPoint(bevel, -1, -1));
assert(!hasPoint(round, -1, -1));
assert(
  round.contours.some(({ points }) =>
    points.some(
      ([x, y]) => x < 0 && y < 0 && Math.abs(Math.hypot(x, y) - 1) < 1e-8,
    ),
  ),
);
assert.equal(strokePath(corner, 2, [], 'butt', 'miter'), miter);
assert(
  hasPoint(strokePath(corner, 2, [], 'round', 'miter'), -1, -1),
  'round end caps do not override corner joins',
);

const sharp = new DrawingPath(false);

sharp.moveTo(-10, 0);
sharp.lineTo(0, 0);
sharp.lineTo(-10, 0.1);

assert.deepEqual(
  strokePath(sharp, 2, [], 'butt', 'miter').contours,
  strokePath(sharp, 2, [], 'butt', 'bevel').contours,
  'corners beyond the default Canvas miter limit fall back to bevel',
);

const joins: CanvasLineJoin[] = [];

Object.assign(globalThis, {
  Path2D: class {
    lineTo() {}
    closePath() {}
  },
});

const ctx = {
  lineJoin: 'bevel' as CanvasLineJoin,
  fill() {},
  stroke() {
    joins.push(this.lineJoin);
  },
} as CanvasRenderingContext2D;

for (const lineJoin of ['miter', 'round', undefined] as const) {
  drawSegment({
    ctx,
    segment: {
      points: [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      lineJoin,
    } as Segment,
  });

  assert.equal(ctx.lineJoin, 'bevel', 'a segment restores the caller join');
}

assert.deepEqual(joins, ['miter', 'round', 'bevel']);
