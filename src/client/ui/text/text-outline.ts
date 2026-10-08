import { withAlpha } from '../../utilities/color';

export interface TextOutlineOptions {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  radius?: number;
  strokeStyle?: string;
}

const outlines = new WeakMap<Path2D, Map<number, Path2D>>();

export const textOutline = ({
  ctx,
  path,
  radius = 1,
  strokeStyle = withAlpha({ color: '#000', alpha: 7 / 15 }),
}: TextOutlineOptions) => {
  let radii = outlines.get(path);

  if (!radii) {
    radii = new Map();
    outlines.set(path, radii);
  }

  let textOutlinePath = radii.get(radius);

  if (!textOutlinePath) {
    textOutlinePath = new Path2D();

    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8;

      textOutlinePath.addPath(path, {
        e: radius * Math.cos(angle),
        f: radius * Math.sin(angle),
      });
    }

    radii.set(radius, textOutlinePath);
  }

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.stroke(textOutlinePath);
  ctx.restore();
};
