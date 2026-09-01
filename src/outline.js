import { colors } from './colors';

export const outline = (ctx, path) => {
  const outlinePath = new Path2D();

  Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;

    outlinePath.addPath(path, { e: Math.cos(angle), f: Math.sin(angle) });
  });

  ctx.save();
  ctx.strokeStyle = `${colors.black[0]}7`;
  ctx.stroke(outlinePath);
  ctx.restore();
};
