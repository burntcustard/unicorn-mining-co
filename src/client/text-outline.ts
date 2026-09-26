export interface TextOutlineOptions {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  radius?: number;
  strokeStyle?: string;
}

export const textOutline = ({
  ctx,
  path,
  radius = 1,
  strokeStyle = '#0007',
}: TextOutlineOptions) => {
  const textOutlinePath = new Path2D();

  Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;

    textOutlinePath.addPath(path, {
      e: radius * Math.cos(angle),
      f: radius * Math.sin(angle),
    });
  });

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.stroke(textOutlinePath);
  ctx.restore();
};
