export interface OutlineOptions {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  radius?: number;
  strokeStyle?: string;
}

export const outline = ({
  ctx,
  path,
  radius = 1,
  strokeStyle = '#0007',
}: OutlineOptions) => {
  const outlinePath = new Path2D();

  Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;

    outlinePath.addPath(path, {
      e: radius * Math.cos(angle),
      f: radius * Math.sin(angle),
    });
  });

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.stroke(outlinePath);
  ctx.restore();
};
