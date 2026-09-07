export const outline = (ctx, path, radius = 1) => {
  const outlinePath = new Path2D();

  Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;

    outlinePath.addPath(path, { e: radius * Math.cos(angle), f: radius * Math.sin(angle) });
  });

  ctx.save();
  ctx.strokeStyle = '#0007';
  ctx.stroke(outlinePath);
  ctx.restore();
};
