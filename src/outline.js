import { colors } from './colors';

export const outline = (ctx, path) => {
  const outlinePath = new Path2D();

  [-1, 0, 1].forEach((x) => [-1, 0, 1].forEach((y) => {
    const length = Math.hypot(x, y);

    outlinePath.addPath(path, new DOMMatrix().translate(x / length, y / length));
  }));

  ctx.save();
  ctx.strokeStyle = colors.black[0] + 8;
  ctx.stroke(outlinePath);
  ctx.restore();
};
