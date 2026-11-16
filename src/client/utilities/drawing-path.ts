import { useWebGL } from '../ui/dom/graphics';
import { sampleCurve } from './curves';

const NativePath = (globalThis.Path2D || class {}) as typeof Path2D;

type Contour = { points: number[][]; closed: boolean };

export class DrawingPath extends NativePath {
  constructor(public native = true) {
    super();
  }
  circle?: number[];
  contours: Contour[] = [];
  revision = 0;
  moveTo(x: number, y: number) {
    this.circle = undefined;

    if (this.native) super.moveTo(x, y);
    this.contours.push({ points: [[x, y]], closed: false });
    this.revision++;
  }
  lineTo(x: number, y: number) {
    this.circle = undefined;

    if (this.native) super.lineTo(x, y);

    if (!this.contours.length) {
      this.moveTo(x, y);
    } else {
      this.contours.at(-1)!.points.push([x, y]);
    }

    this.revision++;
  }
  closePath() {
    if (this.native) super.closePath();

    if (this.contours.length) this.contours.at(-1)!.closed = true;
    this.revision++;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.curveTo([x, y, cx, cy]);
  }
  bezierCurveTo(
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    x: number,
    y: number,
  ) {
    this.curveTo([x, y, cx, cy, dx, dy]);
  }
  private curveTo(point: number[]) {
    this.circle = undefined;

    if (!this.contours.length) this.moveTo(point[2], point[3]);
    const points = this.contours.at(-1)!.points;

    points.push(...sampleCurve(points.at(-1)!, point, 16));

    if (this.native) {
      if (point.length === 4) {
        super.quadraticCurveTo(point[2], point[3], point[0], point[1]);
      } else {
        super.bezierCurveTo(
          point[2],
          point[3],
          point[4],
          point[5],
          point[0],
          point[1],
        );
      }
    }

    this.revision++;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.circle = undefined;

    if (this.native) super.rect(x, y, w, h);

    this.contours.push({
      points: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      closed: true,
    });

    this.revision++;
  }
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    reverse = false,
  ) {
    if (this.native) super.arc(x, y, r, start, end, reverse);
    let turn = end - start;

    if (!reverse && turn >= Math.PI * 2) {
      turn = Math.PI * 2;
    } else if (reverse && turn <= -Math.PI * 2) {
      turn = -Math.PI * 2;
    } else if (reverse && turn > 0) {
      turn -= Math.PI * 2;
    } else if (!reverse && turn < 0) {
      turn += Math.PI * 2;
    }

    if (!this.contours.length && Math.abs(turn) >= Math.PI * 2 && start === 0) {
      this.circle = [x, y, r];
    } else {
      this.circle = undefined;
    }

    const count = Math.max(
      2,
      Math.ceil(Math.abs(turn) * Math.sqrt(Math.max(1, r) * 5)),
    );
    const points = Array.from({ length: count + 1 }, (_, i) => [
      x + Math.cos(start + (turn * i) / count) * r,
      y + Math.sin(start + (turn * i) / count) * r,
    ]);

    if (!this.contours.length) {
      this.contours.push({ points, closed: Math.abs(turn) >= Math.PI * 2 });
    } else {
      this.contours.at(-1)!.points.push(...points);
    }

    this.revision++;
  }
  addPath(path: DrawingPath, matrix?: DOMMatrix2DInit) {
    if (this.native) super.addPath(path, matrix);
    const m = new DOMMatrix(
      matrix
        ? [
            matrix.a ?? 1,
            matrix.b ?? 0,
            matrix.c ?? 0,
            matrix.d ?? 1,
            matrix.e ?? 0,
            matrix.f ?? 0,
          ]
        : undefined,
    );

    this.contours.push(
      ...path.contours.map((c) => ({
        closed: c.closed,
        points: c.points.map(([x, y]) => {
          const p = m.transformPoint({ x, y });

          return [p.x, p.y];
        }),
      })),
    );

    this.revision++;
  }
}

export const createPath = () => (useWebGL ? new DrawingPath() : new Path2D());
